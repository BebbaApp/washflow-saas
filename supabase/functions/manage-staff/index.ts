// manage-staff edge function — rebuilt from scratch
// Deployed via the connected Supabase project.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import bcrypt from "npm:bcryptjs@2.4.3";

const FUNCTION_VERSION = "manage-staff-rebuilt-2026-05-21-staff-manager-role";
const VALID_ROLES = ["admin", "supervisor", "washer", "driver", "manager", "cashier"];
const STAFF_MANAGER_ROLES = ["admin", "manager"];
const ROLE_PRIORITY = ["admin", "supervisor", "manager", "cashier", "washer", "driver"];
const ACCEPTED_ACTIONS = ["list", "set_pin", "clear_pin", "update_role", "delete"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: Record<string, unknown>, status = 200) {
  const enriched =
    body.error !== undefined
      ? { ...body, function_version: FUNCTION_VERSION, accepted_actions: ACCEPTED_ACTIONS }
      : body;
  return new Response(JSON.stringify(enriched), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "x-function-version": FUNCTION_VERSION,
    },
  });
}

// Normalize any incoming action string to a canonical action name.
function normalizeAction(raw: unknown, body: Record<string, any>): string {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  const map: Record<string, string> = {
    list: "list",
    list_staff: "list",
    list_users: "list",
    staff_list: "list",
    get_staff: "list",

    set_pin: "set_pin",
    save_pin: "set_pin",
    update_pin: "set_pin",
    create_pin: "set_pin",
    upsert_pin: "set_pin",

    clear_pin: "clear_pin",
    remove_pin: "clear_pin",
    delete_pin: "clear_pin",

    update_role: "update_role",
    set_role: "update_role",
    change_role: "update_role",

    delete: "delete",
    delete_user: "delete",
    remove_user: "delete",
  };
  if (map[s]) return map[s];
  // Infer from payload shape if no/unknown action.
  if (body?.user_id && body?.pin) return "set_pin";
  if (body?.user_id && body?.role && !body?.pin) return "update_role";
  return "";
}

async function resolveCallerTenantId(
  admin: any,
  user: any,
  callerId: string,
  requestedTenantId?: string | null,
): Promise<string | null> {
  if (typeof requestedTenantId === "string" && requestedTenantId.trim()) {
    const [{ data: membership }, { data: platformAdmin }] = await Promise.all([
      admin
        .from("tenant_members")
        .select("tenant_id")
        .eq("user_id", callerId)
        .eq("tenant_id", requestedTenantId)
        .maybeSingle(),
      admin.from("platform_admins").select("user_id").eq("user_id", callerId).maybeSingle(),
    ]);
    return membership || platformAdmin ? requestedTenantId : null;
  }

  const claimedTenant = user?.app_metadata?.active_tenant_id;
  if (typeof claimedTenant === "string" && claimedTenant.trim()) {
    return claimedTenant;
  }

  const { data: memberships, error } = await admin
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", callerId)
    .limit(1);

  if (error) throw error;
  return memberships?.[0]?.tenant_id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return reply({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userErr || !userData?.user) return reply({ error: "Unauthorized" }, 401);
    const callerId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const action = normalizeAction(body?.action, body);

    // Resolve caller's tenant once (service-role bypasses current_tenant_id()).
    // Prefer the active workspace sent by the client because localStorage is not
    // visible to Edge Functions and a user may belong to multiple tenants.
    const tenantId = await resolveCallerTenantId(admin, userData.user, callerId, body?.tenant_id);
    if (!tenantId) {
      return reply({ error: "Unable to resolve tenant" }, 400);
    }

    const [{ data: callerRoles }, { data: callerMemberships }, { data: platformAdmin }] = await Promise.all([
      admin.from("user_roles").select("role,tenant_id").eq("user_id", callerId),
      admin.from("tenant_members").select("tenant_id,tenant_role").eq("user_id", callerId),
      admin.from("platform_admins").select("user_id").eq("user_id", callerId).maybeSingle(),
    ]);
    const tenantRoles = (callerRoles ?? []).filter((r: any) => r.tenant_id === tenantId);
    const tenantMembership = (callerMemberships ?? []).find((m: any) => m.tenant_id === tenantId);
    const hasStaffManagerRole = tenantRoles.some((r: any) => STAFF_MANAGER_ROLES.includes(r.role)) ||
      (callerRoles ?? []).some((r: any) => STAFF_MANAGER_ROLES.includes(r.role) && !r.tenant_id);
    const isTenantAdmin = tenantMembership?.tenant_role === "owner" || tenantMembership?.tenant_role === "admin";
    const isPlatformAdmin = !!platformAdmin;
    if (!hasStaffManagerRole && !isTenantAdmin && !isPlatformAdmin) {
      return reply({ error: "Only admins can manage staff" }, 403);
    }

    if (!action) {
      return reply({ error: "Unknown action", received: body?.action ?? null }, 400);
    }

    if (action === "list") {
      const { data: list, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (error) return reply({ error: error.message }, 500);
      const ids = list.users.map((u) => u.id);
      const [{ data: profiles }, { data: roles }, { data: pins }] = await Promise.all([
        admin.from("profiles").select("user_id,name").in("user_id", ids),
        admin.from("user_roles").select("user_id,role").eq("tenant_id", tenantId).in("user_id", ids),
        admin.from("staff_pins").select("user_id,phone").eq("tenant_id", tenantId).in("user_id", ids),
      ]);
      const pMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p.name]));
      const pinMap = new Map((pins ?? []).map((p: any) => [p.user_id, p.phone]));
      const rMap = new Map<string, string[]>();
      (roles ?? []).forEach((r: any) => {
        const arr = rMap.get(r.user_id) ?? [];
        arr.push(r.role);
        rMap.set(r.user_id, arr);
      });
      const users = list.users.map((u) => {
        const userRoles = rMap.get(u.id) ?? [];
        return {
          id: u.id,
          email: u.email ?? "",
          name: pMap.get(u.id) ?? (u.user_metadata?.name as string) ?? "",
          role: ROLE_PRIORITY.find((p) => userRoles.includes(p)) ?? null,
          roles: userRoles,
          phone: pinMap.get(u.id) ?? null,
          has_pin: pinMap.has(u.id),
          email_confirmed: !!u.email_confirmed_at,
          created_at: u.created_at,
        };
      });
      return reply({ users });
    }

    if (action === "set_pin") {
      const { user_id, phone, pin } = body ?? {};
      if (!user_id || !phone || !pin) {
        return reply({ error: "user_id, phone and pin are required" }, 400);
      }
      if (!/^\d{4,6}$/.test(String(pin))) {
        return reply({ error: "PIN must be 4-6 digits" }, 400);
      }
      const normalizedPhone = String(phone).replace(/\s+/g, "");
      const pin_hash = bcrypt.hashSync(String(pin), bcrypt.genSaltSync(8));
      const { data: existing } = await admin
        .from("staff_pins")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("phone", normalizedPhone)
        .maybeSingle();
      if (existing && existing.user_id !== user_id) {
        return reply({ error: "This phone number is already used by another worker" }, 400);
      }
      await admin.from("staff_pins").delete().eq("user_id", user_id).eq("tenant_id", tenantId);
      const { error } = await admin
        .from("staff_pins")
        .insert({ user_id, phone: normalizedPhone, pin_hash, tenant_id: tenantId });
      if (error) return reply({ error: error.message }, 500);
      return reply({ success: true });
    }

    if (action === "clear_pin") {
      const { user_id } = body ?? {};
      if (!user_id) return reply({ error: "Missing user_id" }, 400);
      const { error } = await admin.from("staff_pins").delete().eq("user_id", user_id).eq("tenant_id", tenantId);
      if (error) return reply({ error: error.message }, 500);
      return reply({ success: true });
    }

    if (action === "update_role") {
      const { user_id, role } = body ?? {};
      if (!user_id || !VALID_ROLES.includes(role)) {
        return reply({ error: "Invalid input" }, 400);
      }
      await admin.from("user_roles").delete().eq("user_id", user_id).eq("tenant_id", tenantId);
      const { error } = await admin
        .from("user_roles")
        .insert({ user_id, role, tenant_id: tenantId });
      if (error) return reply({ error: error.message }, 500);
      return reply({ success: true });
    }

    if (action === "delete") {
      const { user_id } = body ?? {};
      if (!user_id) return reply({ error: "Missing user_id" }, 400);
      if (user_id === callerId) {
        return reply({ error: "You cannot delete your own account" }, 400);
      }
      const { data: targetRoles } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", user_id)
        .eq("tenant_id", tenantId);
      if ((targetRoles ?? []).some((r: any) => r.role === "admin")) {
        return reply({ error: "Admin users cannot be deleted" }, 400);
      }
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) return reply({ error: error.message }, 500);
      return reply({ success: true });
    }

    return reply({ error: "Unknown action" }, 400);
  } catch (err) {
    return reply({ error: (err as Error).message }, 500);
  }
});
