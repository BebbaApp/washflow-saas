import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VALID_ROLES = ["admin", "supervisor", "washer", "driver", "manager", "cashier"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await anonClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);
    const callerId = claims.claims.sub as string;

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: callerRoles } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    const isAdmin = (callerRoles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) return json({ error: "Only admins can manage staff" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;

    if (action === "list") {
      const { data: usersList, error: usersErr } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
      if (usersErr) return json({ error: usersErr.message }, 500);

      const ids = usersList.users.map((u) => u.id);
      const [{ data: profiles }, { data: roles }, { data: pins }] = await Promise.all([
        adminClient.from("profiles").select("user_id,name").in("user_id", ids),
        adminClient.from("user_roles").select("user_id,role").in("user_id", ids),
        adminClient.from("staff_pins").select("user_id,phone").in("user_id", ids),
      ]);

      const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p.name]));
      const pinMap = new Map((pins ?? []).map((p) => [p.user_id, p.phone]));
      const rolesMap = new Map<string, string[]>();
      (roles ?? []).forEach((r) => {
        const arr = rolesMap.get(r.user_id) ?? [];
        arr.push(r.role);
        rolesMap.set(r.user_id, arr);
      });
      const priority = ["admin", "supervisor", "manager", "cashier", "washer", "driver"];

      const users = usersList.users.map((u) => {
        const userRoles = rolesMap.get(u.id) ?? [];
        const primary = priority.find((p) => userRoles.includes(p)) ?? null;
        return {
          id: u.id,
          email: u.email ?? "",
          name: profileMap.get(u.id) ?? (u.user_metadata?.name as string) ?? "",
          role: primary,
          roles: userRoles,
          phone: pinMap.get(u.id) ?? null,
          has_pin: pinMap.has(u.id),
          email_confirmed: !!u.email_confirmed_at,
          created_at: u.created_at,
        };
      });

      return json({ users });
    }

    if (action === "set_pin") {
      const { user_id, phone, pin } = body;
      if (!user_id || !phone || !pin) return json({ error: "user_id, phone and pin are required" }, 400);
      if (!/^\d{4,6}$/.test(String(pin))) return json({ error: "PIN must be 4-6 digits" }, 400);
      const normalizedPhone = String(phone).replace(/\s+/g, "");
      const salt = bcrypt.genSaltSync(8);
      const pin_hash = bcrypt.hashSync(String(pin), salt);
      // Ensure phone uniqueness across other users
      const { data: existing } = await adminClient
        .from("staff_pins")
        .select("user_id")
        .eq("phone", normalizedPhone)
        .maybeSingle();
      if (existing && existing.user_id !== user_id) {
        return json({ error: "This phone number is already used by another worker" }, 400);
      }
      await adminClient.from("staff_pins").delete().eq("user_id", user_id);
      const { error } = await adminClient
        .from("staff_pins")
        .insert({ user_id, phone: normalizedPhone, pin_hash });
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    if (action === "clear_pin") {
      const { user_id } = body;
      if (!user_id) return json({ error: "Missing user_id" }, 400);
      const { error } = await adminClient.from("staff_pins").delete().eq("user_id", user_id);
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    if (action === "update_role") {
      const { user_id, role } = body;
      if (!user_id || !VALID_ROLES.includes(role)) return json({ error: "Invalid input" }, 400);
      // Replace all role rows with the single new role
      await adminClient.from("user_roles").delete().eq("user_id", user_id);
      const { error } = await adminClient.from("user_roles").insert({ user_id, role });
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    if (action === "delete") {
      const { user_id } = body;
      if (!user_id) return json({ error: "Missing user_id" }, 400);
      if (user_id === callerId) return json({ error: "You cannot delete your own account" }, 400);

      const { data: targetRoles } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", user_id);
      if ((targetRoles ?? []).some((r) => r.role === "admin")) {
        return json({ error: "Admin users cannot be deleted" }, 400);
      }

      const { error } = await adminClient.auth.admin.deleteUser(user_id);
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
