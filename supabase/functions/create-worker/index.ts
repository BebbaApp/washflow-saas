import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

const STAFF_MANAGER_ROLES = ["admin", "manager"];
const BOOTSTRAP_SUPER_ADMIN_EMAIL = "postfastbiz@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await anonClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerId = claims.claims.sub as string;

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { email, password, name, role, phone, pin, tenant_id } = await req.json();

    if (!email || !password || !name || !role || !tenant_id) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: callerRoles }, { data: callerMembership }, { data: platformAdmin }, { data: superAdmin }] = await Promise.all([
      adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", callerId)
        .eq("tenant_id", tenant_id),
      adminClient
        .from("tenant_members")
        .select("tenant_role")
        .eq("user_id", callerId)
        .eq("tenant_id", tenant_id)
        .maybeSingle(),
      adminClient.from("platform_admins").select("user_id").eq("user_id", callerId).maybeSingle(),
      adminClient.from("super_admins").select("user_id").eq("user_id", callerId).maybeSingle(),
    ]);

    const hasStaffManagerRole = (callerRoles ?? []).some((r: any) => STAFF_MANAGER_ROLES.includes(r.role));
    const isTenantAdmin = callerMembership?.tenant_role === "owner" || callerMembership?.tenant_role === "admin";
    const isGlobalAdmin = !!platformAdmin || !!superAdmin || claims.claims.email?.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL;
    if (!hasStaffManagerRole && !isTenantAdmin && !isGlobalAdmin) {
      return new Response(JSON.stringify({ error: "Only admins can create workers" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validRoles = ["admin", "supervisor", "washer", "driver", "manager", "cashier"];
    if (!validRoles.includes(role)) {
      return new Response(JSON.stringify({ error: "Invalid role" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create auth user. We set `invited_to_tenant` in app_metadata so the
    // `handle_new_user_tenant` trigger skips creating a brand-new tenant for
    // this worker (they are joining an existing tenant). Some existing DBs also
    // have an auth confirmation trigger that writes tenant-scoped roles without
    // a tenant context; if that path fails, retry unconfirmed and assign the
    // correct tenant role below with the service-role client.
    const userPayload = {
      email,
      password,
      user_metadata: { name },
      app_metadata: { active_tenant_id: tenant_id, invited_to_tenant: tenant_id },
    };
    let { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
      ...userPayload,
      email_confirm: true,
    });

    if (createErr?.message?.toLowerCase().includes("database error creating new user")) {
      const retry = await adminClient.auth.admin.createUser({
        ...userPayload,
        email_confirm: false,
      });
      newUser = retry.data;
      createErr = retry.error;
    }

    if (createErr) {
      return new Response(JSON.stringify({ error: createErr.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!newUser?.user?.id) {
      return new Response(JSON.stringify({ error: "User was not created" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: memberErr } = await adminClient.from("tenant_members").upsert(
      { tenant_id, user_id: newUser.user.id, tenant_role: "member" },
      { onConflict: "tenant_id,user_id" },
    );

    if (memberErr) {
      return new Response(JSON.stringify({ error: memberErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Assign role
    const { error: roleErr } = await adminClient.from("user_roles").insert({
      user_id: newUser.user.id,
      tenant_id,
      role,
    });

    if (roleErr) {
      return new Response(JSON.stringify({ error: roleErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Optional phone + PIN for PIN-based login
    if (phone && pin && /^\d{4,6}$/.test(String(pin))) {
      const salt = bcrypt.genSaltSync(8);
      const pin_hash = bcrypt.hashSync(String(pin), salt);
      const normalizedPhone = String(phone).replace(/\s+/g, "");
      const { error: pinErr } = await adminClient.from("staff_pins").insert({
        user_id: newUser.user.id,
        tenant_id,
        phone: normalizedPhone,
        pin_hash,
      });
      if (pinErr) {
        return new Response(JSON.stringify({ error: `User created but PIN failed: ${pinErr.message}`, user_id: newUser.user.id }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, user_id: newUser.user.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
