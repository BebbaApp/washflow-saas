// log-attendance-audit — service-role insert into attendance_audit_log
// so that manual overrides always succeed regardless of the caller's
// active_tenant_id JWT claim. Verifies the caller is a member of the
// target tenant (and has an admin-ish role) before inserting.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ADMIN_ROLES = new Set(["owner", "admin"]);

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return reply({ error: "missing_auth" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: uErr } = await userClient.auth.getUser();
  if (uErr || !userData?.user) return reply({ error: "invalid_session" }, 401);
  const caller = userData.user;

  let body: any;
  try { body = await req.json(); } catch { return reply({ error: "invalid_json" }, 400); }

  const {
    tenant_id, attendance_id, target_user_id, action, reason,
    original_score = null, original_status = null, created_at = null,
  } = body ?? {};

  if (!tenant_id || !target_user_id || !action || !reason) {
    return reply({ error: "missing_fields" }, 400);
  }
  if (String(reason).trim().length < 5) return reply({ error: "reason_too_short" }, 400);

  const admin = createClient(url, service);

  // Verify caller is a member of this tenant with an admin-ish role
  // (or a platform/super admin).
  const [{ data: membership }, { data: platform }, { data: superAdm }] = await Promise.all([
    admin.from("tenant_members").select("tenant_role")
      .eq("tenant_id", tenant_id).eq("user_id", caller.id).maybeSingle(),
    admin.from("platform_admins").select("user_id").eq("user_id", caller.id).maybeSingle(),
    admin.from("super_admins").select("user_id").eq("user_id", caller.id).maybeSingle(),
  ]);

  const isPlatform = !!platform || !!superAdm;
  const memberRole = membership?.tenant_role as string | undefined;
  const isAdminMember = memberRole ? ADMIN_ROLES.has(memberRole) : false;

  if (!isPlatform && !isAdminMember) {
    return reply({ error: "not_authorized" }, 403);
  }

  const row = {
    id: crypto.randomUUID(),
    tenant_id,
    attendance_id: attendance_id ?? null,
    target_user_id,
    acted_by: caller.id,
    action,
    reason: String(reason).trim(),
    original_score,
    original_status,
    created_at: created_at ?? new Date().toISOString(),
  };

  const { error } = await admin.from("attendance_audit_log").insert(row);
  if (error) return reply({ error: error.message }, 500);

  return reply({ ok: true, row });
});
