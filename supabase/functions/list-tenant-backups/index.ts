// Read-only listing of tenant_backups + tenant_health_checks for a tenant.
// Owner/admin of tenant, or platform admin. Uses service-role bypass because
// the tables are locked down to service_role only.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const BodySchema = z.object({ tenant_id: z.string().uuid() });

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
    const { tenant_id } = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);
    const [{ data: pa }, { data: sa }, { data: mem }] = await Promise.all([
      admin.from("platform_admins").select("user_id").eq("user_id", uid).maybeSingle(),
      admin.from("super_admins").select("user_id").eq("user_id", uid).maybeSingle(),
      admin.from("tenant_members").select("tenant_role").eq("user_id", uid).eq("tenant_id", tenant_id).maybeSingle(),
    ]);
    const isPrivileged = !!pa || !!sa;
    const isOwnerAdmin = mem && ["owner","admin"].includes((mem as any).tenant_role);
    if (!isPrivileged && !isOwnerAdmin) return json({ error: "Forbidden" }, 403);

    const [{ data: backups }, { data: health }] = await Promise.all([
      admin.from("tenant_backups")
        .select("id, tenant_id, created_at, kind, row_counts, size_bytes, storage_path, checksum")
        .eq("tenant_id", tenant_id)
        .order("created_at", { ascending: false })
        .limit(200),
      admin.from("tenant_health_checks")
        .select("*")
        .eq("tenant_id", tenant_id)
        .order("checked_at", { ascending: false })
        .limit(30),
    ]);

    return json({ backups: backups ?? [], health: health ?? [] }, 200);
  } catch (e) {
    console.error("list-tenant-backups error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status: number) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
