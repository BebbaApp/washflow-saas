// Nightly per-tenant snapshot + health check + retention cleanup.
// Invoked by pg_cron (see phase45_tenant_backups.sql). Also callable manually
// from the Platform Console for a single tenant (POST { tenant_id, kind:'manual' }).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  BACKUP_TABLES,
  INLINE_SNAPSHOT_MAX_BYTES,
  NIGHTLY_RETAIN,
  MONTHLY_RETAIN,
} from "../_shared/backupTables.ts";

async function sha256Hex(text: string) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function snapshotTenant(admin: any, tenantId: string, kind: "nightly"|"manual"|"pre_restore", actor?: string) {
  const snapshot: Record<string, any[]> = {};
  const rowCounts: Record<string, number> = {};
  for (const { name: table, orderBy } of BACKUP_TABLES) {
    // Page through in 1000-row chunks to bypass PostgREST's default 1000 cap.
    let from = 0;
    const rows: any[] = [];
    while (true) {
      const { data, error } = await admin
        .from(table)
        .select("*")
        .eq("tenant_id", tenantId)
        .order(orderBy, { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(`snapshot ${table}: ${error.message}`);
      const batch = data ?? [];
      rows.push(...batch);
      if (batch.length < 1000) break;
      from += 1000;
    }
    snapshot[table] = rows;
    rowCounts[table] = rows.length;
  }

  const json = JSON.stringify(snapshot);
  const size = new Blob([json]).size;
  const checksum = await sha256Hex(json);

  let storagePath: string | null = null;
  let inlineSnapshot: any = snapshot;
  if (size > INLINE_SNAPSHOT_MAX_BYTES) {
    storagePath = `${tenantId}/${new Date().toISOString()}-${kind}.json`;
    const up = await admin.storage.from("tenant-backups").upload(storagePath, json, {
      contentType: "application/json",
      upsert: false,
    });
    if (up.error) throw new Error(`storage upload: ${up.error.message}`);
    inlineSnapshot = null;
  }

  const { error: insErr } = await admin.from("tenant_backups").insert({
    tenant_id: tenantId,
    kind,
    row_counts: rowCounts,
    snapshot: inlineSnapshot,
    storage_path: storagePath,
    size_bytes: size,
    checksum,
    created_by: actor ?? null,
  });
  if (insErr) throw new Error(`insert backup: ${insErr.message}`);
  return { size, rowCounts, storagePath };
}

async function runHealthChecks(admin: any, tenantId: string) {
  const findings: any[] = [];

  const { data: orphOrders } = await admin.rpc("noop_ignore").select().limit(0).then(() => ({ data: [] })).catch(() => ({ data: [] }));
  // orphan orders (customer_id set but no matching customer)
  const { data: ordersWithCust } = await admin
    .from("orders").select("id, customer_id").eq("tenant_id", tenantId).not("customer_id","is",null).limit(5000);
  if (ordersWithCust?.length) {
    const ids = [...new Set(ordersWithCust.map((o: any) => o.customer_id))];
    const { data: cust } = await admin.from("customers").select("id").in("id", ids);
    const found = new Set((cust ?? []).map((c: any) => c.id));
    const orphans = ordersWithCust.filter((o: any) => !found.has(o.customer_id));
    if (orphans.length)
      findings.push({ check: "orphan_orders", count: orphans.length, sample: orphans.slice(0, 5).map((o: any) => o.id) });
  }

  // duplicate order_number within tenant
  const { data: orderNums } = await admin
    .from("orders").select("order_number").eq("tenant_id", tenantId).limit(10000);
  if (orderNums?.length) {
    const seen: Record<string, number> = {};
    for (const r of orderNums) if (r.order_number) seen[r.order_number] = (seen[r.order_number] ?? 0) + 1;
    const dups = Object.entries(seen).filter(([, n]) => n > 1);
    if (dups.length)
      findings.push({ check: "duplicate_order_number", count: dups.length, sample: dups.slice(0, 5).map(([k]) => k) });
  }

  // negative stock
  const { data: negStock } = await admin
    .from("inventory_items").select("id, name, current_stock").eq("tenant_id", tenantId).lt("current_stock", 0);
  if (negStock?.length)
    findings.push({ check: "negative_stock", count: negStock.length, sample: negStock.slice(0, 5) });

  // discount > service_price
  const { data: badDisc } = await admin
    .from("orders").select("id, service_price, discount").eq("tenant_id", tenantId).limit(5000);
  const badDiscount = (badDisc ?? []).filter((o: any) => Number(o.discount ?? 0) > Number(o.service_price ?? 0));
  if (badDiscount.length)
    findings.push({ check: "discount_exceeds_price", count: badDiscount.length, sample: badDiscount.slice(0, 5).map((o: any) => o.id) });

  const status = findings.some((f) => ["orphan_orders","duplicate_order_number","negative_stock"].includes(f.check))
    ? "critical"
    : (findings.length ? "warning" : "ok");

  await admin.from("tenant_health_checks").insert({ tenant_id: tenantId, status, findings });
  return { status, findings };
}

async function pruneBackups(admin: any, tenantId: string) {
  const { data: all } = await admin
    .from("tenant_backups")
    .select("id, created_at, kind, storage_path")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (!all?.length) return;
  const nightlies = all.filter((b: any) => b.kind === "nightly");
  const keep = new Set<string>();
  nightlies.slice(0, NIGHTLY_RETAIN).forEach((b: any) => keep.add(b.id));
  const byMonth: Record<string, any> = {};
  for (const b of nightlies) {
    const m = (b.created_at as string).slice(0, 7);
    if (!byMonth[m]) byMonth[m] = b;
  }
  Object.values(byMonth).slice(0, MONTHLY_RETAIN).forEach((b: any) => keep.add(b.id));
  all.filter((b: any) => b.kind !== "nightly").forEach((b: any) => keep.add(b.id));

  const toDelete = all.filter((b: any) => !keep.has(b.id));
  if (!toDelete.length) return;
  const paths = toDelete.map((b: any) => b.storage_path).filter(Boolean);
  if (paths.length) await admin.storage.from("tenant-backups").remove(paths);
  await admin.from("tenant_backups").delete().in("id", toDelete.map((b: any) => b.id));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Optional body: { tenant_id, kind }. When absent, run nightly for every tenant.
    let body: any = {};
    try { body = await req.json(); } catch { /* empty */ }
    const kind: "nightly"|"manual"|"pre_restore" = body.kind ?? "nightly";

    let tenantIds: string[] = [];
    if (body.tenant_id) {
      tenantIds = [body.tenant_id];
    } else {
      const { data } = await admin.from("tenants").select("id");
      tenantIds = (data ?? []).map((r: any) => r.id);
    }

    const results: any[] = [];
    for (const tid of tenantIds) {
      try {
        const snap = await snapshotTenant(admin, tid, kind);
        const health = await runHealthChecks(admin, tid);
        await pruneBackups(admin, tid);
        results.push({ tenant_id: tid, ok: true, size_bytes: snap.size, health: health.status, findings: health.findings.length });
      } catch (e) {
        results.push({ tenant_id: tid, ok: false, error: (e as Error).message });
      }
    }

    // When invoked for a single tenant, surface the failure as an HTTP error
    // so callers (e.g. the Platform Console) can display it instead of showing
    // a false-positive success toast.
    if (body.tenant_id && results[0] && !results[0].ok) {
      return json({ error: results[0].error, results }, 500);
    }
    return json({ ran: results.length, results }, 200);
  } catch (e) {
    console.error("backup-tenants error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status: number) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
