// Export a tenant's full data as JSON. Owner/admin of the tenant, or platform admin.
// POST { tenant_id, backup_id? }
//   - When backup_id is given: returns that snapshot.
//   - Otherwise builds a fresh snapshot and returns it (does not persist).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";
import { BACKUP_TABLES } from "../_shared/backupTables.ts";

const BodySchema = z.object({
  tenant_id: z.string().uuid(),
  backup_id: z.string().uuid().optional(),
});

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

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { tenant_id, backup_id } = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    // Auth: platform admin OR owner/admin of this tenant.
    const [{ data: pa }, { data: sa }, { data: mem }] = await Promise.all([
      admin.from("platform_admins").select("user_id").eq("user_id", uid).maybeSingle(),
      admin.from("super_admins").select("user_id").eq("user_id", uid).maybeSingle(),
      admin.from("tenant_members").select("tenant_role").eq("user_id", uid).eq("tenant_id", tenant_id).maybeSingle(),
    ]);
    const isPrivileged = !!pa || !!sa;
    const isOwnerAdmin = mem && ["owner","admin"].includes((mem as any).tenant_role);
    if (!isPrivileged && !isOwnerAdmin) return json({ error: "Forbidden" }, 403);

    // Fetch from an existing backup, or build fresh.
    let snapshot: Record<string, any[]> = {};
    let source: string;
    if (backup_id) {
      const { data: b } = await admin.from("tenant_backups").select("*").eq("id", backup_id).eq("tenant_id", tenant_id).maybeSingle();
      if (!b) return json({ error: "Backup not found" }, 404);
      if (b.snapshot) snapshot = b.snapshot;
      else if (b.storage_path) {
        const { data, error } = await admin.storage.from("tenant-backups").download(b.storage_path);
        if (error) return json({ error: error.message }, 500);
        snapshot = JSON.parse(await data.text());
      }
      source = `backup:${backup_id}`;
    } else {
      for (const { name: table, orderBy } of BACKUP_TABLES) {
        let from = 0; const rows: any[] = [];
        while (true) {
          const { data } = await admin.from(table).select("*").eq("tenant_id", tenant_id).order(orderBy).range(from, from + 999);
          const batch = data ?? []; rows.push(...batch);
          if (batch.length < 1000) break;
          from += 1000;
        }
        snapshot[table] = rows;
      }
      source = "live";
    }

    const { data: tenant } = await admin.from("tenants").select("id, name, slug").eq("id", tenant_id).maybeSingle();
    const payload = {
      tenant,
      exported_at: new Date().toISOString(),
      exported_by: uid,
      source,
      snapshot,
    };
    const body = JSON.stringify(payload, null, 2);
    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${tenant?.slug ?? tenant_id}-export.json"`,
      },
    });
  } catch (e) {
    console.error("export-tenant error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status: number) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
