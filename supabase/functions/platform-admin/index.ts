// Super-admin console backend. All actions require the caller to be in
// public.platform_admins. Uses service role for cross-tenant operations.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_tenants") }),
  z.object({ action: z.literal("list_users"), tenant_id: z.string().uuid().optional() }),
  z.object({ action: z.literal("set_tenant_status"),
    tenant_id: z.string().uuid(),
    status: z.enum(["trialing", "active", "past_due", "suspended", "cancelled"]) }),
  z.object({ action: z.literal("extend_trial"),
    tenant_id: z.string().uuid(), days: z.number().int().min(1).max(365) }),
  z.object({ action: z.literal("change_plan"),
    tenant_id: z.string().uuid(), plan_id: z.string().uuid() }),
  z.object({ action: z.literal("impersonate_tenant"),
    tenant_id: z.string().uuid() }),
  z.object({ action: z.literal("grant_platform_admin"),
    user_id: z.string().uuid() }),
  z.object({ action: z.literal("revoke_platform_admin"),
    user_id: z.string().uuid() }),
  z.object({ action: z.literal("add_tenant_member"),
    tenant_id: z.string().uuid(),
    user_id: z.string().uuid(),
    tenant_role: z.enum(["owner", "admin", "member"]).default("member") }),
  z.object({ action: z.literal("remove_tenant_member"),
    tenant_id: z.string().uuid(), user_id: z.string().uuid() }),
  z.object({ action: z.literal("update_tenant"),
    tenant_id: z.string().uuid(),
    name: z.string().min(1).max(120).optional(),
    slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/).optional() }),
  z.object({ action: z.literal("get_platform_settings") }),
  z.object({ action: z.literal("update_platform_settings"),
    currency: z.string().min(1).max(8).optional(),
    vat_rate: z.number().min(0).max(100).optional(),
    company_name: z.string().max(200).optional(),
    contact_email: z.string().max(200).optional(),
    contact_phone: z.string().max(50).optional(),
    address: z.string().max(500).optional() }),
  z.object({ action: z.literal("platform_overview"),
    from: z.string().optional(),
    to: z.string().optional(),
    tenant_id: z.string().uuid().optional() }),
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const callerId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: isAdminRow } = await admin
      .from("platform_admins").select("user_id").eq("user_id", callerId).maybeSingle();
    if (!isAdminRow) return json({ error: "Forbidden: platform admin only" }, 403);

    const parsed = ActionSchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const body = parsed.data;

    switch (body.action) {
      case "list_tenants": {
        const { data, error } = await admin
          .from("platform_tenants_overview")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) return json({ error: error.message }, 500);
        return json({ tenants: data });
      }

      case "list_users": {
        const { data: list, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
        if (error) return json({ error: error.message }, 500);
        const ids = list.users.map((u) => u.id);
        const [{ data: profiles }, { data: members }, { data: padmins }] = await Promise.all([
          admin.from("profiles").select("user_id,name").in("user_id", ids),
          admin.from("tenant_members").select("user_id,tenant_id,tenant_role").in("user_id", ids),
          admin.from("platform_admins").select("user_id").in("user_id", ids),
        ]);
        const nameMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p.name]));
        const padminSet = new Set((padmins ?? []).map((p: any) => p.user_id));
        const memberMap = new Map<string, Array<{ tenant_id: string; tenant_role: string }>>();
        (members ?? []).forEach((m: any) => {
          const arr = memberMap.get(m.user_id) ?? [];
          arr.push({ tenant_id: m.tenant_id, tenant_role: m.tenant_role });
          memberMap.set(m.user_id, arr);
        });
        let users = list.users.map((u) => ({
          id: u.id,
          email: u.email ?? "",
          name: nameMap.get(u.id) ?? (u.user_metadata?.name as string) ?? "",
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          is_platform_admin: padminSet.has(u.id),
          memberships: memberMap.get(u.id) ?? [],
        }));
        if (body.tenant_id) {
          users = users.filter((u) => u.memberships.some((m) => m.tenant_id === body.tenant_id));
        }
        return json({ users });
      }

      case "set_tenant_status": {
        const patch: Record<string, unknown> = { status: body.status };
        if (body.status === "past_due") {
          patch.grace_period_ends_at = new Date(Date.now() + 7 * 86_400_000).toISOString();
        }
        const { error } = await admin.from("tenants").update(patch).eq("id", body.tenant_id);
        if (error) return json({ error: error.message }, 500);
        await admin.from("license_events").insert({
          tenant_id: body.tenant_id, kind: "platform.status_changed",
          payload: { by: callerId, status: body.status },
        });
        return json({ ok: true });
      }

      case "extend_trial": {
        const { data: t } = await admin.from("tenants")
          .select("trial_ends_at").eq("id", body.tenant_id).single();
        const base = t?.trial_ends_at ? new Date(t.trial_ends_at) : new Date();
        const next = new Date(Math.max(base.getTime(), Date.now()) + body.days * 86_400_000);
        const { error } = await admin.from("tenants")
          .update({ trial_ends_at: next.toISOString(), status: "trialing" })
          .eq("id", body.tenant_id);
        if (error) return json({ error: error.message }, 500);
        await admin.from("license_events").insert({
          tenant_id: body.tenant_id, kind: "platform.trial_extended",
          payload: { by: callerId, days: body.days, until: next.toISOString() },
        });
        return json({ ok: true, trial_ends_at: next.toISOString() });
      }

      case "change_plan": {
        const { error } = await admin.from("tenants")
          .update({ plan_id: body.plan_id }).eq("id", body.tenant_id);
        if (error) return json({ error: error.message }, 500);
        await admin.from("license_events").insert({
          tenant_id: body.tenant_id, kind: "platform.plan_changed",
          payload: { by: callerId, plan_id: body.plan_id },
        });
        return json({ ok: true });
      }

      case "impersonate_tenant": {
        // Write the active_tenant_id claim for the calling platform admin
        // so RLS lets them browse the workspace as if they were a member.
        const { data: u } = await admin.auth.admin.getUserById(callerId);
        const newAppMeta = { ...(u?.user?.app_metadata ?? {}), active_tenant_id: body.tenant_id };
        const { error } = await admin.auth.admin.updateUserById(callerId, { app_metadata: newAppMeta });
        if (error) return json({ error: error.message }, 500);
        await admin.from("license_events").insert({
          tenant_id: body.tenant_id, kind: "platform.impersonate",
          payload: { by: callerId },
        });
        return json({ ok: true });
      }

      case "grant_platform_admin": {
        const { error } = await admin.from("platform_admins")
          .insert({ user_id: body.user_id });
        if (error && (error as any).code !== "23505") return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "revoke_platform_admin": {
        if (body.user_id === callerId) return json({ error: "Cannot revoke yourself" }, 400);
        const { error } = await admin.from("platform_admins")
          .delete().eq("user_id", body.user_id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "add_tenant_member": {
        const { error } = await admin.from("tenant_members")
          .upsert({ tenant_id: body.tenant_id, user_id: body.user_id, tenant_role: body.tenant_role });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "remove_tenant_member": {
        const { error } = await admin.from("tenant_members")
          .delete().eq("tenant_id", body.tenant_id).eq("user_id", body.user_id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
    }
  } catch (e) {
    console.error("platform-admin error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
