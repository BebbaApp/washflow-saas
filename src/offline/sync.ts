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
  "user_roles",
  "tenant_members",
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
      // Permission denied is expected for some tables (e.g. user without role) — skip silently.
      if (/permission|denied|policy/i.test(error.message)) return;
      throw new Error(`pull ${table}: ${error.message}`);
    }
    const rows = (data as any[]) ?? [];
    if (rows.length === 0) break;
    await (db as any)[table].bulkPut(
      rows.map((r) => ({ ...withLocalId(table, r), _dirty: 0 as 0 })),
    );
    for (const r of rows) {
      if (r?.updated_at && r.updated_at > highWater) highWater = r.updated_at;
    }
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  await db.sync_meta.put({ key, last_pulled_at: hasUpdatedAt ? highWater : new Date().toISOString() });
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
      if (it.op === "insert") {
        ({ error } = await tbl.insert(it.payload as any));
      } else if (it.op === "update") {
        ({ error } = await tbl.update(it.payload as any).eq("id", (it.payload as any).id));
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
  if (currentTenant === tenantId) return;
  currentTenant = tenantId;
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

/** Force a full resync — clears the cursor and re-pulls everything. */
export async function forceResync() {
  if (!currentTenant) return;
  await db.sync_meta.where("key").startsWith(`${currentTenant}:`).delete();
  await initialPull(currentTenant);
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

/** Prune oldest rows from high-volume tables to free space. Returns rows removed. */
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
  await prune("orders", keepOrders);
  await prune("inventory_transactions", keepTx);
  await prune("loyalty_transactions", keepLoyalty);
  await db.sync_meta.where("key").anyOf([
    metaKey(t, "orders"), metaKey(t, "inventory_transactions"), metaKey(t, "loyalty_transactions"),
  ]).delete();
  return removed;
}

// Auto-drain when connectivity returns / tab regains focus.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { setStatus("online", null); schedulePush(0); });
  window.addEventListener("offline", () => setStatus("offline"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") schedulePush(0);
  });
}
