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
const ATTENDANCE_KINDS = new Set(["check_in", "check_out"]);

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
    attendance_record = null,
  } = body ?? {};

  if (!tenant_id || !target_user_id || !action || !reason) {
    return reply({ error: "missing_fields" }, 400);
  }
  if (String(reason).trim().length < 5) return reply({ error: "reason_too_short" }, 400);

  const shouldCreateAttendance = attendance_record && typeof attendance_record === "object";
  const attendanceKind = shouldCreateAttendance ? String(attendance_record.kind ?? "") : "";
  const attendanceCreatedAt = String(attendance_record?.created_at ?? created_at ?? new Date().toISOString());
  const attendanceNotes = String(attendance_record?.notes ?? `Admin override: ${String(reason).trim()}`);

  if (shouldCreateAttendance) {
    if (!ATTENDANCE_KINDS.has(attendanceKind)) return reply({ error: "invalid_attendance_kind" }, 400);
    if (Number.isNaN(new Date(attendanceCreatedAt).getTime())) return reply({ error: "invalid_attendance_date" }, 400);
    if (attendanceNotes.length > 1000) return reply({ error: "attendance_notes_too_long" }, 400);
  }

  const admin = createClient(url, service);

  // Verify caller is a member of this tenant with an admin-ish role
  // (or a platform/super admin).
  const [{ data: membership }, { data: roleRow }, { data: platform }, { data: superAdm }] = await Promise.all([
    admin.from("tenant_members").select("tenant_role")
      .eq("tenant_id", tenant_id).eq("user_id", caller.id).maybeSingle(),
    admin.from("user_roles").select("role")
      .eq("tenant_id", tenant_id).eq("user_id", caller.id).eq("role", "admin").maybeSingle(),
    admin.from("platform_admins").select("user_id").eq("user_id", caller.id).maybeSingle(),
    admin.from("super_admins").select("user_id").eq("user_id", caller.id).maybeSingle(),
  ]);

  const isPlatform = !!platform || !!superAdm;
  const memberRole = membership?.tenant_role as string | undefined;
  const isAdminMember = memberRole ? ADMIN_ROLES.has(memberRole) : false;
  const isAdminRole = !!roleRow;

  if (!isPlatform && !isAdminMember && !isAdminRole) {
    return reply({ error: "not_authorized" }, 403);
  }

  const [{ data: targetMember }, { data: targetRole }] = await Promise.all([
    admin.from("tenant_members").select("user_id")
      .eq("tenant_id", tenant_id).eq("user_id", target_user_id).maybeSingle(),
    admin.from("user_roles").select("user_id")
      .eq("tenant_id", tenant_id).eq("user_id", target_user_id).maybeSingle(),
  ]);
  if (!targetMember && !targetRole) {
    return reply({ error: "target_not_in_workspace" }, 400);
  }

  let attendanceId = attendance_id ?? null;
  let attendanceRow: Record<string, unknown> | null = null;

  if (shouldCreateAttendance) {
    attendanceRow = {
      id: crypto.randomUUID(),
      tenant_id,
      user_id: target_user_id,
      kind: attendanceKind,
      selfie_url: null,
      match_score: null,
      status: "manual",
      notes: attendanceNotes,
      created_at: attendanceCreatedAt,
    };

    // Try the caller-scoped insert first so database triggers that inspect
    // auth.uid() can recognize the admin actor and allow manual overrides.
    // If the JWT tenant claim is stale and RLS blocks it, fall back to the
    // already-authorized service-role insert.
    let insertResult = await userClient
      .from("attendance_records")
      .insert(attendanceRow)
      .select("id,tenant_id,user_id,kind,selfie_url,match_score,status,notes,created_at")
      .single();

    if (insertResult.error) {
      insertResult = await admin
        .from("attendance_records")
        .insert(attendanceRow)
        .select("id,tenant_id,user_id,kind,selfie_url,match_score,status,notes,created_at")
        .single();
    }

    const { data: insertedRecord, error: attendanceError } = insertResult;
    if (attendanceError) return reply({ error: attendanceError.message }, 500);
    attendanceRow = insertedRecord;
    attendanceId = insertedRecord.id;
  }

  const row = {
    id: crypto.randomUUID(),
    tenant_id,
    attendance_id: attendanceId,
    target_user_id,
    acted_by: caller.id,
    action,
    reason: String(reason).trim(),
    original_score,
    original_status,
    created_at: created_at ?? new Date().toISOString(),
  };

  const { error } = await admin.from("attendance_audit_log").insert(row);
  if (error) {
    if (attendanceRow?.id) {
      await admin
        .from("attendance_records")
        .delete()
        .eq("tenant_id", tenant_id)
        .eq("id", attendanceRow.id);
    }
    return reply({ error: error.message }, 500);
  }

  return reply({ ok: true, row, record: attendanceRow });
});
