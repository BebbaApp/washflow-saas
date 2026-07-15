// Restore a tenant from a tenant_backups snapshot. Platform-admin only.
// POST { backup_id: uuid, confirm_slug: string }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import {
  BACKUP_TABLES,
  RESTORE_DELETE_ORDER,
  RESTORE_INSERT_ORDER,
} from "../_shared/backupTables.ts";

const BodySchema = z.object({
  backup_id: z.string().uuid(),
  confirm_slug: z.string().min(1),
});

async function loadSnapshot(admin: any, backup: any): Promise<Record<string, any[]>> {
  if (backup.snapshot) return backup.snapshot;
  if (backup.storage_path) {
    const { data, error } = await admin.storage.from("tenant-backups").download(backup.storage_path);
    if (error) throw new Error(`download snapshot: ${error.message}`);
    const text = await data.text();
    return JSON.parse(text);
  }
  throw new Error("backup has no snapshot payload");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    const uid = claims?.claims?.sub as string | undefined;
    if (!uid) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: pa } = await admin.from("platform_admins").select("user_id").eq("user_id", uid).maybeSingle();
    const { data: sa } = await admin.from("super_admins").select("user_id").eq("user_id", uid).maybeSingle();
    if (!pa && !sa) return json({ error: "Forbidden" }, 403);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { backup_id, confirm_slug } = parsed.data;

    const { data: backup, error: backupErr } = await admin
      .from("tenant_backups").select("*").eq("id", backup_id).maybeSingle();
    if (backupErr || !backup) return json({ error: "Backup not found" }, 404);

    const { data: tenant } = await admin.from("tenants").select("id, slug").eq("id", backup.tenant_id).maybeSingle();
    if (!tenant) return json({ error: "Tenant not found" }, 404);
    if (tenant.slug !== confirm_slug) return json({ error: "Slug confirmation does not match" }, 400);

    // 1) Take a pre_restore snapshot via the backup-tenants function pattern.
    // Inline call: reuse admin to snapshot only this tenant.
    // (Kept lightweight — just re-select and insert one row.)
    const preSnapshot: Record<string, any[]> = {};
    const preCounts: Record<string, number> = {};
    for (const table of BACKUP_TABLES) {
      let from = 0; const rows: any[] = [];
      while (true) {
        const { data } = await admin.from(table).select("*").eq("tenant_id", tenant.id).order("id").range(from, from + 999);
        const batch = data ?? []; rows.push(...batch);
        if (batch.length < 1000) break;
        from += 1000;
      }
      preSnapshot[table] = rows; preCounts[table] = rows.length;
    }
    const preJson = JSON.stringify(preSnapshot);
    await admin.from("tenant_backups").insert({
      tenant_id: tenant.id,
      kind: "pre_restore",
      row_counts: preCounts,
      snapshot: preSnapshot,
      size_bytes: new Blob([preJson]).size,
      created_by: uid,
    });

    // 2) Load target snapshot.
    const snapshot = await loadSnapshot(admin, backup);

    // 3) Delete existing rows in child-first order.
    for (const table of RESTORE_DELETE_ORDER) {
      const { error } = await admin.from(table).delete().eq("tenant_id", tenant.id);
      if (error) throw new Error(`delete ${table}: ${error.message}`);
    }

    // 4) Insert snapshot rows in parent-first order.
    for (const table of RESTORE_INSERT_ORDER) {
      const rows = snapshot[table] ?? [];
      if (!rows.length) continue;
      // Insert in batches of 500 to keep payloads reasonable.
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await admin.from(table).insert(batch);
        if (error) throw new Error(`insert ${table}: ${error.message}`);
      }
    }

    // 5) Bump restored_at so clients wipe local cache.
    await admin.from("tenants").update({ restored_at: new Date().toISOString() }).eq("id", tenant.id);

    return json({ ok: true, restored_from: backup.id, tenant_id: tenant.id }, 200);
  } catch (e) {
    console.error("restore-tenant error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status: number) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
