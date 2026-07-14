// Cross-tenant staff operations for owners/admins.
// Actions: list | update_role | remove
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }),
  z.object({ action: z.literal("update_role"), tenant_id: z.string().uuid(), user_id: z.string().uuid(), tenant_role: z.enum(["owner", "admin", "member"]) }),
  z.object({ action: z.literal("remove"), tenant_id: z.string().uuid(), user_id: z.string().uuid() }),
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: cErr } = await userClient.auth.getClaims(token);
    const uid = claims?.claims?.sub as string | undefined;
    const email = (claims?.claims?.email as string | undefined) ?? null;
    if (cErr || !uid) return json({ error: "Unauthorized" }, 401);

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);

    const admin = createClient(url, service);
    const { data: sa } = await admin.from("super_admins").select("user_id").eq("user_id", uid).maybeSingle();
    const isSuper = !!sa;

    // Load caller's owner/admin tenants
    let ownedTenantIds: string[] = [];
    let callerRoleByTenant: Record<string, string> = {};
    if (isSuper) {
      const { data } = await admin.from("tenants").select("id");
      ownedTenantIds = ((data ?? []) as any[]).map((r) => r.id);
      ownedTenantIds.forEach((id) => { callerRoleByTenant[id] = "owner"; });
    } else {
      const { data } = await admin.from("tenant_members").select("tenant_id, tenant_role")
        .eq("user_id", uid).in("tenant_role", ["owner", "admin"]);
      ((data ?? []) as any[]).forEach((r) => {
        ownedTenantIds.push(r.tenant_id);
        callerRoleByTenant[r.tenant_id] = r.tenant_role;
      });
    }

    const body = parsed.data;

    if (body.action === "list") {
      if (ownedTenantIds.length === 0) return json({ members: [], tenants: [] }, 200);
      const [{ data: tenants }, { data: members }] = await Promise.all([
        admin.from("tenants").select("id, name, slug").in("id", ownedTenantIds),
        admin.from("tenant_members").select("tenant_id, user_id, tenant_role").in("tenant_id", ownedTenantIds),
      ]);
      const userIds = Array.from(new Set(((members ?? []) as any[]).map((m) => m.user_id)));
      const { data: profiles } = await admin.from("profiles").select("user_id, name").in("user_id", userIds);
      // Emails come from auth.users
      const emailMap: Record<string, string> = {};
      for (const id of userIds) {
        try {
          const { data } = await admin.auth.admin.getUserById(id);
          if (data?.user?.email) emailMap[id] = data.user.email;
        } catch { /* ignore */ }
      }
      return json({ tenants: tenants ?? [], members: members ?? [], profiles: profiles ?? [], emails: emailMap }, 200);
    }

    // mutating actions must be scoped to a tenant the caller owns/admins
    if (!ownedTenantIds.includes(body.tenant_id)) return json({ error: "Not authorized for this workspace" }, 403);
    const callerRole = callerRoleByTenant[body.tenant_id];

    if (body.action === "update_role") {
      if (body.tenant_role === "owner" && callerRole !== "owner" && !isSuper) {
        return json({ error: "Only owners can promote to owner" }, 403);
      }
      const { error } = await admin.from("tenant_members")
        .update({ tenant_role: body.tenant_role })
        .eq("tenant_id", body.tenant_id).eq("user_id", body.user_id);
      if (error) return json({ error: error.message }, 500);
      await admin.from("membership_audit_log").insert({
        tenant_id: body.tenant_id, actor_user_id: uid, actor_email: email,
        target_user_id: body.user_id, action: "member.role_updated", to_role: body.tenant_role,
      });
      return json({ ok: true }, 200);
    }

    if (body.action === "remove") {
      if (body.user_id === uid) return json({ error: "Use Workspace settings to leave a workspace" }, 400);
      const { error } = await admin.from("tenant_members")
        .delete().eq("tenant_id", body.tenant_id).eq("user_id", body.user_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true }, 200);
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (e) {
    console.error("owner-staff error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
