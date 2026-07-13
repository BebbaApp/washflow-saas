// Sync engine: keeps the local Dexie mirror in step with Supabase for the
// active tenant, and drains queued local mutations from the outbox.
//
// Three loops:
//   1. Initial pull  — paginated select per table for the current tenant
//   2. Realtime pull — postgres_changes subscriptions upsert/delete locally
//   3. Push drain    — replays outbox items while online; backoff on error
//
// Conflict policy: server-wins on reads (we overwrite local rows from realtime
// payloads), last-write-wins on push (we send the local row; the server's
// updated_at will reflect the winner on the next pull).

import { supabase } from "@/integrations/supabase/client";
import {
  db,
  metaKey,
  MIRRORED_TABLES,
  type BaseRow,
  type MirroredTable,
  type OutboxItem,
} from "./db";

type Channel = ReturnType<typeof supabase.channel>;

const PAGE_SIZE = 1000;
let currentTenant: string | null = null;
let channels: Channel[] = [];
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pulling = false;

const TABLES_WITHOUT_UPDATED_AT = new Set<MirroredTable>([
  "loyalty_transactions",
  "shifts",
  "shift_templates",
  "time_off_requests",
  "attendance_records",
  "staff_face_enrollments",
  "staff_pins",
  "user_roles",
  "tenant_members",
  "customers",
  "expenses",
  "expense_categories",
  "inventory_categories",
  "inventory_transactions",
]);

const tableOrderColumn = (table: MirroredTable) => {
  if (table === "tenant_members" || table === "receipt_settings" || table === "role_permissions") return "tenant_id";
  return "id";
};

const withLocalId = (table: MirroredTable, row: any) => {
  if (row?.id) return row;
  if (table === "tenant_members") return { ...row, id: `${row.tenant_id}:${row.user_id}` };
  if (table === "receipt_settings" || table === "role_permissions") return { ...row, id: row.tenant_id };
  return row;
};

const edgeFallbackPullers: Partial<Record<MirroredTable, (tenantId: string) => Promise<any[]>>> = {
  orders: async (tenantId: string) => {
    const { data, error } = await supabase.functions.invoke("sync-mutation", {
      body: { action: "list", op: "list", table: "orders", tenant_id: tenantId, payload: {} },
    });
    if (error) throw error;
    const rows = (data as any)?.rows;
    return Array.isArray(rows) ? rows : [];
  },
  attendance_records: async (tenantId: string) => {
    const { data, error } = await supabase.functions.invoke("manage-staff", {
      body: { action: "list_attendance_records", tenant_id: tenantId },
    });
    if (error) throw error;
    const rows = (data as any)?.attendance_records;
    return Array.isArray(rows) ? rows : [];
  },
  staff_face_enrollments: async (tenantId: string) => {
    const { data, error } = await supabase.functions.invoke("manage-staff", {
      body: { action: "list_face_enrollments", tenant_id: tenantId },
    });
    if (error) throw error;
    const rows = (data as any)?.face_enrollments;
    return Array.isArray(rows) ? rows : [];
  },
};

const EDGE_SYNC_WRITE_TABLES = new Set<string>([
  "orders",
  "expenses",
  "inventory_items",
  "inventory_transactions",
]);

async function pushMutationViaEdge(it: OutboxItem, payload: any) {
  const { data, error } = await supabase.functions.invoke("sync-mutation", {
    body: {
      tenant_id: it.tenant_id,
      table: it.table,
      op: it.op,
      payload,
    },
  });
  if (error) {
    // supabase-js wraps HTTP errors as "Edge Function returned a non-2xx
    // status code" and stashes the Response on `error.context`. Read the
    // body so the sync panel shows the real reason (validation, RLS,
    // membership) instead of the generic wrapper message.
    let detail = error.message;
    try {
      const resp = (error as any)?.context;
      if (resp && typeof resp.text === "function") {
        const text = await resp.text();
        if (text) {
          try {
            const parsed = JSON.parse(text);
            const err = (parsed as any)?.error;
            detail = typeof err === "string" ? err : JSON.stringify(err ?? parsed);
          } catch {
            detail = text;
          }
        }
      }
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  return (data as any)?.row ?? null;
}

async function markLocalMutationSynced(it: OutboxItem, syncedRow: any, payload: any) {
  if (it.op === "delete") return;
  if (!MIRRORED_TABLES.includes(it.table as MirroredTable)) return;
  const table = it.table as MirroredTable;
  const tbl = (db as any)[table];
  const rowId = syncedRow?.id ?? payload?.id;
  if (!tbl || !rowId) return;
  const existing = await tbl.get(rowId);
  const next = withLocalId(table, {
    ...(existing ?? {}),
    ...(syncedRow ?? payload),
    tenant_id: (syncedRow ?? payload)?.tenant_id ?? it.tenant_id,
    _dirty: 0 as 0,
  });
  delete (next as any)._op;
  await tbl.put(next);
}

type Status = "idle" | "pulling" | "online" | "offline" | "error";
type Listener = (s: { status: Status; pending: number; lastError?: string | null }) => void;
const listeners = new Set<Listener>();
let lastStatus: Status = "idle";
let lastError: string | null = null;

function emit() {
  void db.outbox.count().then((pending) => {
    for (const l of listeners) l({ status: lastStatus, pending, lastError });
  });
}

export function onSyncStatus(l: Listener) {
  listeners.add(l);
  emit();
  return () => listeners.delete(l);
}

function setStatus(s: Status, err?: string | null) {
  lastStatus = s;
  if (err !== undefined) lastError = err;
  emit();
}

async function pullTable(tenantId: string, table: MirroredTable) {
  const key = metaKey(tenantId, table);
  const meta = await db.sync_meta.get(key);
  const since = meta?.last_pulled_at;

  // Page through rows for the tenant. We order by id (stable across pages even
  // when updated_at is null) and, on incremental pulls, include rows whose
  // updated_at is either newer than the cursor OR null — old rows that
  // predate the touch trigger have null updated_at and would otherwise never
  // make it into the local mirror.
  let from = 0;
  const hasUpdatedAt = !TABLES_WITHOUT_UPDATED_AT.has(table);
  let highWater = since ?? "1970-01-01T00:00:00Z";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = supabase.from(table as any).select("*").order(tableOrderColumn(table), { ascending: true }).range(from, from + PAGE_SIZE - 1);
    q = q.eq("tenant_id", tenantId);
    if (since && hasUpdatedAt) q = q.or(`updated_at.gt.${since},updated_at.is.null`);
    const { data, error } = await q;
    if (error) {
      const fallbackPull = edgeFallbackPullers[table];
      if (fallbackPull && /permission|denied|policy|jwt|claim|rls/i.test(error.message)) {
        const fallbackRows = await fallbackPull(tenantId);
        await replacePulledRows(table, tenantId, fallbackRows);
        await db.sync_meta.put({ key, last_pulled_at: new Date().toISOString() });
        return;
      }
      // Permission denied is expected for some tables (e.g. user without role) — skip silently.
      if (/permission|denied|policy/i.test(error.message)) return;
      throw new Error(`pull ${table}: ${error.message}`);
    }
    let rows = (data as any[]) ?? [];
    let usedFallback = false;
    const fallbackPull = edgeFallbackPullers[table];
    if ((rows.length === 0 || table === "orders") && fallbackPull) {
      const fallbackRows = await fallbackPull(tenantId);
      if (fallbackRows.length > 0) {
        rows = fallbackRows;
        usedFallback = true;
      }
    }
    if (rows.length === 0) break;
    await (db as any)[table].bulkPut(
      rows.map((r) => ({ ...withLocalId(table, r), _dirty: 0 as 0 })),
    );
    for (const r of rows) {
      if (r?.updated_at && r.updated_at > highWater) highWater = r.updated_at;
    }
    if (usedFallback || rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  await db.sync_meta.put({ key, last_pulled_at: hasUpdatedAt ? highWater : new Date().toISOString() });
}

async function replacePulledRows(table: MirroredTable, tenantId: string, rows: any[]) {
  const tbl = (db as any)[table];
  const dirtyRows = await tbl.where("tenant_id").equals(tenantId).and((row: any) => row?._dirty === 1).toArray();
  await tbl.where("tenant_id").equals(tenantId).and((row: any) => row?._dirty !== 1).delete();
  if (rows.length > 0) {
    await tbl.bulkPut(rows.map((r) => ({ ...withLocalId(table, r), _dirty: 0 as 0 })));
  }
  if (dirtyRows.length > 0) await tbl.bulkPut(dirtyRows);
}

async function initialPull(tenantId: string) {
  setStatus("pulling");
  try {
    // Run in parallel for speed; Supabase REST handles many concurrent reads fine.
    await Promise.all(MIRRORED_TABLES.map((t) => pullTable(tenantId, t).catch((e) => {
      console.warn("[sync] pull failed", t, e);
    })));
    setStatus("online", null);
  } catch (e: any) {
    setStatus("error", e?.message ?? String(e));
  }
}

function subscribeRealtime(tenantId: string) {
  unsubscribeRealtime();
  for (const table of MIRRORED_TABLES) {
    const filter = `tenant_id=eq.${tenantId}`;
    const ch = supabase
      .channel(`offline_${table}_${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter },
        async (payload) => {
          try {
            const tbl = (db as any)[table];
            if (payload.eventType === "DELETE") {
              const id = withLocalId(table, payload.old as any)?.id;
              if (id) await tbl.delete(id);
            } else {
              const row = withLocalId(table, payload.new as BaseRow);
              if (row?.id) await tbl.put({ ...row, _dirty: 0 });
            }
          } catch (e) {
            console.warn("[sync] realtime apply failed", table, e);
          }
        },
      )
      .subscribe();
    channels.push(ch);
  }
}

function unsubscribeRealtime() {
  for (const c of channels) {
    try { supabase.removeChannel(c); } catch { /* ignore */ }
  }
  channels = [];
}

async function refreshRealtimeAuth() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) await supabase.realtime.setAuth(token);
}

async function ensureActiveTenantClaim(tenantId: string) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  const { data } = await supabase.auth.getSession();
  const activeClaim = (data.session?.user?.app_metadata as any)?.active_tenant_id;
  if (!data.session || activeClaim === tenantId) return false;

  const { error } = await supabase.functions.invoke("switch-tenant", {
    body: { tenant_id: tenantId },
  });
  if (error) throw new Error(error.message || "Workspace session sync failed");

  const { error: refreshErr } = await supabase.auth.refreshSession();
  if (refreshErr) throw refreshErr;
  await refreshRealtimeAuth();
  return true;
}

/** Enqueue a local mutation. Hooks call this instead of writing to Supabase
 *  directly so we can replay when offline. The local mirror should also be
 *  updated optimistically by the caller. */
export async function enqueueOutbox(item: Omit<OutboxItem, "id" | "attempts" | "created_at">) {
  await db.outbox.add({ ...item, attempts: 0, created_at: Date.now() });
  schedulePush();
}

function schedulePush(delay = 100) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { void drainOutbox(); }, delay);
}

async function drainOutbox() {
  if (!navigator.onLine) { setStatus("offline"); return; }
  const items = await db.outbox.orderBy("created_at").limit(50).toArray();
  if (items.length === 0) { emit(); return; }
  for (const it of items) {
    try {
      const tbl = supabase.from(it.table as any);
      let error: any = null;
      const stripUA = (p: any) => {
        if (!p || typeof p !== "object") return p;
        if (!TABLES_WITHOUT_UPDATED_AT.has(it.table as MirroredTable)) return p;
        const { updated_at: _u, ...rest } = p;
        return rest;
      };
      let syncedRow: any = null;
      if (EDGE_SYNC_WRITE_TABLES.has(it.table)) {
        let payload: any = stripUA(it.payload);
        syncedRow = await pushMutationViaEdge(it, payload);
        await markLocalMutationSynced(it, syncedRow, payload);
      } else if (it.op === "insert") {
        let payload: any = stripUA(it.payload);
        // Reconcile offline-issued order numbers (WO-LOC-XXX) with the
        // server's canonical WO-XXX sequence before insert. If the RPC
        // fails we fall through and let Postgres reject the duplicate so
        // we retry on next drain rather than persisting a placeholder.
        if (it.table === "orders" && typeof payload?.order_number === "string" && /^WO-/i.test(payload.order_number)) {
          const { data: fresh, error: rpcErr } = await supabase.rpc("next_order_number");
          if (rpcErr) throw rpcErr;
          if (fresh) {
            const newNumber = fresh as unknown as string;
            payload = { ...payload, order_number: newNumber };
            // Update local mirror so the UI swaps to the canonical reference.
            try {
              const local = await (db as any).orders.get(payload.id);
              if (local) {
                await (db as any).orders.put({ ...local, order_number: newNumber });
              }
            } catch { /* ignore mirror update */ }
          }
        }
        ({ error } = await tbl.insert(payload as any));
        if (!error) await markLocalMutationSynced(it, null, payload);
      } else if (it.op === "update") {
        const payload = stripUA(it.payload);
        ({ error } = await tbl.update(payload as any).eq("id", (payload as any).id));
        if (!error) await markLocalMutationSynced(it, null, payload);
      } else if (it.op === "delete") {
        ({ error } = await tbl.delete().eq("id", (it.payload as any).id));
      }
      if (error) throw error;
      await db.outbox.delete(it.id!);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      await db.outbox.update(it.id!, { attempts: it.attempts + 1, last_error: msg });
      // Stop the loop on transient errors; retry with backoff.
      schedulePush(Math.min(30_000, 1000 * 2 ** Math.min(it.attempts, 5)));
      setStatus("error", msg);
      return;
    }
  }
  setStatus("online", null);
  // Drain remaining items in next tick.
  if ((await db.outbox.count()) > 0) schedulePush(50);
  else emit();
}

/** Start syncing for a tenant. Safe to call repeatedly; switching tenants
 *  swaps subscriptions and triggers a fresh pull. */
export async function startSync(tenantId: string) {
  // Guard: don't attempt any sync/edge calls without a valid, server-verified
  // session. Prevents 401 blank-screen errors on /login or after the session
  // has been revoked server-side (stale token still cached in localStorage).
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    setStatus("idle");
    return;
  }
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    // Stale/revoked token — clear it locally so callers stop retrying.
    try { await supabase.auth.signOut({ scope: "local" } as any); } catch { /* ignore */ }
    setStatus("idle");
    return;
  }
  if (currentTenant === tenantId) {
    void ensureActiveTenantClaim(tenantId)
      .then((changed) => {
        if (changed) {
          subscribeRealtime(tenantId);
          void backgroundPull();
        }
      })
      .catch((e) => {
        setStatus("error", e?.message ?? String(e));
      });
    return;
  }
  currentTenant = tenantId;
  try {
    await ensureActiveTenantClaim(tenantId);
    await refreshRealtimeAuth();
  } catch (e: any) {
    setStatus("error", e?.message ?? String(e));
  }
  // One-shot cursor reset for clients that mirrored data before the
  // null-updated_at fix landed; ensures historical completed/cancelled rows
  // get pulled on next boot.
  try {
    const FLAG = "wf_sync_reset_v2";
    if (typeof localStorage !== "undefined" && !localStorage.getItem(FLAG)) {
      await db.sync_meta.clear();
      localStorage.setItem(FLAG, "1");
    }
  } catch { /* ignore storage errors */ }
  subscribeRealtime(tenantId);
  if (!pulling) {
    pulling = true;
    try { await initialPull(tenantId); } finally { pulling = false; }
  }
  schedulePush(0);
}

export function stopSync() {
  currentTenant = null;
  unsubscribeRealtime();
  setStatus("idle");
}

/** Wipe local data for a tenant (used on logout or tenant switch when the
 *  user no longer has access). */
export async function purgeTenant(tenantId: string) {
  await Promise.all(
    MIRRORED_TABLES.map((t) => (db as any)[t].where("tenant_id").equals(tenantId).delete()),
  );
  await db.sync_meta.where("key").startsWith(`${tenantId}:`).delete();
  await db.outbox.where("tenant_id").equals(tenantId).delete();
}

/** Force a full resync — resets pull cursors and re-pulls the entire tenant
 *  dataset from the server without first deleting visible local data. This is
 *  intentionally non-destructive: if a table is temporarily hidden by RLS/JWT
 *  claim drift, the queue should not go blank while the retry path repairs it.
 *  Pending writes (`_dirty === 1`) are preserved. */
export async function forceResync() {
  if (!currentTenant) return;
  const t = currentTenant;
  // Wait for any in-flight pull to finish so we don't race with it.
  while (pulling) await new Promise((r) => setTimeout(r, 100));
  pulling = true;
  try {
    await db.sync_meta.where("key").startsWith(`${t}:`).delete();
    // Also re-subscribe realtime so any missed channels reconnect cleanly.
    subscribeRealtime(t);
    await initialPull(t);
  } finally {
    pulling = false;
  }
}

/** Background incremental pull for the active tenant. Cheap when cursors are
 *  up to date; used to refresh data whenever the tab comes back online or
 *  regains focus so the UI never lags behind the database while online. */
export async function backgroundPull() {
  if (!currentTenant) return;
  if (!navigator.onLine) return;
  if (pulling) return;
  const t = currentTenant;
  pulling = true;
  try {
    await Promise.all(MIRRORED_TABLES.map((tbl) => pullTable(t, tbl).catch((e) => {
      console.warn("[sync] background pull failed", tbl, e);
    })));
    setStatus("online", null);
  } finally {
    pulling = false;
  }
}

export interface SyncHealthRow {
  table: MirroredTable;
  server: number | null;   // null when the count query failed / not authorised
  local: number;
  diff: number;            // server - local (positive = missing locally)
  error?: string;
}

export interface SyncHealthReport {
  tenant_id: string;
  checked_at: string;
  rows: SyncHealthRow[];
  diverged: SyncHealthRow[];
  ok: boolean;
}

/** Compare Supabase and Dexie row counts for every mirrored table for the
 *  current tenant. Any row where the counts differ is flagged so the UI can
 *  warn the operator that the local mirror is out of step with the database. */
export async function checkSyncHealth(): Promise<SyncHealthReport | null> {
  if (!currentTenant) return null;
  const t = currentTenant;
  const rows: SyncHealthRow[] = await Promise.all(
    MIRRORED_TABLES.map(async (table) => {
      let server: number | null = null;
      let error: string | undefined;
      try {
        const { count, error: err } = await supabase
          .from(table as any)
          .select("*", { count: "exact", head: true })
          .eq("tenant_id", t);
        if (err) {
          // Permission denied is expected for tables the user can't read (e.g. audit-only)
          if (/permission|denied|policy/i.test(err.message)) {
            server = null;
          } else {
            error = err.message;
          }
        } else {
          server = count ?? 0;
          const fallbackPull = edgeFallbackPullers[table];
          if (fallbackPull) {
            const fallbackCount = (await fallbackPull(t)).length;
            if (server === null || fallbackCount > server) server = fallbackCount;
          }
        }
      } catch (e: any) {
        error = e?.message ?? String(e);
      }
      const local = await (db as any)[table].where("tenant_id").equals(t).count();
      const diff = server == null ? 0 : server - local;
      return { table, server, local, diff, error };
    }),
  );
  const diverged = rows.filter((r) => r.server != null && r.diff !== 0);
  return {
    tenant_id: t,
    checked_at: new Date().toISOString(),
    rows,
    diverged,
    ok: diverged.length === 0,
  };
}


/** Returns the most recent outbox items for the current tenant (newest first). */
export async function getOutboxItems(limit = 50): Promise<OutboxItem[]> {
  const items = await db.outbox.orderBy("created_at").reverse().limit(limit).toArray();
  if (!currentTenant) return items;
  return items.filter((i) => i.tenant_id === currentTenant);
}

/** Retry a single outbox item now (resets its attempt counter & error). */
export async function retryOutboxItem(id: number) {
  await db.outbox.update(id, { attempts: 0, last_error: null });
  schedulePush(0);
}

/** Permanently drop an outbox item — the local mutation is abandoned.
 *  The next pull will overwrite any optimistic change with the server row. */
export async function discardOutboxItem(id: number) {
  await db.outbox.delete(id);
  emit();
}

/** Drain all retryable items immediately. */
export async function retryAllOutbox() {
  await db.outbox.toCollection().modify({ attempts: 0, last_error: null });
  schedulePush(0);
}

/** Wipe the local cache for the current tenant and re-pull from scratch.
 *  Outbox is preserved so pending writes are not lost. */
export async function clearLocalCache() {
  if (!currentTenant) return;
  const t = currentTenant;
  await Promise.all(MIRRORED_TABLES.map((tbl) => (db as any)[tbl].where("tenant_id").equals(t).delete()));
  await db.sync_meta.where("key").startsWith(`${t}:`).delete();
  await initialPull(t);
}

/** Best-effort storage usage from the browser quota API. */
export async function getStorageEstimate(): Promise<{ usage?: number; quota?: number } | null> {
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      return await navigator.storage.estimate();
    }
  } catch { /* ignore */ }
  return null;
}

/** Prune oldest rows from high-volume tables to free space. Returns rows removed.
 *  After pruning, the cleared tables are re-pulled from the server so the UI
 *  doesn't sit on a hollowed-out local cache until the next full boot. */
export async function pruneLocalCache(opts: { keepOrders?: number; keepTx?: number; keepLoyalty?: number } = {}) {
  if (!currentTenant) return 0;
  const t = currentTenant;
  const keepOrders = opts.keepOrders ?? 500;
  const keepTx = opts.keepTx ?? 500;
  const keepLoyalty = opts.keepLoyalty ?? 500;
  let removed = 0;
  const prune = async (table: MirroredTable, keep: number) => {
    const rows = await (db as any)[table].where("tenant_id").equals(t).toArray();
    if (rows.length <= keep) return;
    const sorted = rows.sort((a: any, b: any) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
    const toDelete = sorted.slice(keep).map((r: any) => r.id);
    await (db as any)[table].bulkDelete(toDelete);
    removed += toDelete.length;
  };
  const targets: MirroredTable[] = ["orders", "inventory_transactions", "loyalty_transactions"];
  await prune("orders", keepOrders);
  await prune("inventory_transactions", keepTx);
  await prune("loyalty_transactions", keepLoyalty);
  // Reset cursors so the next pull fetches everything again from the server.
  await db.sync_meta.where("key").anyOf(targets.map((tbl) => metaKey(t, tbl))).delete();
  // Kick off a fresh pull immediately so the UI re-hydrates from the server
  // rather than showing an empty cache until the app is reloaded.
  setStatus("pulling");
  try {
    await Promise.all(targets.map((tbl) => pullTable(t, tbl).catch((e) => {
      console.warn("[sync] post-prune pull failed", tbl, e);
    })));
    setStatus("online", null);
  } catch (e: any) {
    setStatus("error", e?.message ?? String(e));
  }
  return removed;
}


// Auto-drain and refresh when connectivity returns / tab regains focus.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    setStatus("online", null);
    schedulePush(0);
    void backgroundPull();
  });
  window.addEventListener("offline", () => setStatus("offline"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      schedulePush(0);
      void backgroundPull();
    }
  });
}
