// manage-staff edge function — rebuilt from scratch
// Deployed via the connected Supabase project.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import bcrypt from "npm:bcryptjs@2.4.3";

const FUNCTION_VERSION = "manage-staff-2026-07-10-scoped-face-enrollment";
const BOOTSTRAP_SUPER_ADMIN_EMAIL = "postfastbiz@gmail.com";
const VALID_ROLES = ["admin", "supervisor", "washer", "driver", "manager", "cashier"];
const STAFF_MANAGER_ROLES = ["admin", "manager"];
const ROLE_PRIORITY = ["admin", "supervisor", "manager", "cashier", "washer", "driver"];
const ACCEPTED_ACTIONS = ["list", "set_pin", "clear_pin", "update_role", "save_compensation", "enroll_face", "delete", "resend_verification"];

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

    save_compensation: "save_compensation",
    set_compensation: "save_compensation",
    upsert_compensation: "save_compensation",

    delete: "delete",
    delete_user: "delete",
    remove_user: "delete",

    resend_verification: "resend_verification",
    send_verification: "resend_verification",
    resend_confirmation: "resend_verification",
    send_confirmation_email: "resend_verification",

    enroll_face: "enroll_face",
    face_enroll: "enroll_face",
    save_face: "enroll_face",
  };
  if (map[s]) return map[s];
  // Infer from payload shape if no/unknown action.
  if (body?.user_id && body?.pin) return "set_pin";
  if (body?.user_id && body?.role && !body?.pin) return "update_role";
  return "";
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid enrollment image");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType: match[1] || "image/jpeg" };
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

    const [{ data: callerRoles }, { data: callerMemberships }, { data: platformAdmin }, { data: superAdmin }] = await Promise.all([
      admin.from("user_roles").select("role,tenant_id").eq("user_id", callerId),
      admin.from("tenant_members").select("tenant_id,tenant_role").eq("user_id", callerId),
      admin.from("platform_admins").select("user_id").eq("user_id", callerId).maybeSingle(),
      admin.from("super_admins").select("user_id").eq("user_id", callerId).maybeSingle(),
    ]);
    const tenantRoles = (callerRoles ?? []).filter((r: any) => r.tenant_id === tenantId);
    const tenantMembership = (callerMemberships ?? []).find((m: any) => m.tenant_id === tenantId);
    const isTenantMember = !!tenantMembership;
    const hasStaffManagerRole = tenantRoles.some((r: any) => STAFF_MANAGER_ROLES.includes(r.role)) ||
      (callerRoles ?? []).some((r: any) => STAFF_MANAGER_ROLES.includes(r.role) && !r.tenant_id);
    const isTenantAdmin = tenantMembership?.tenant_role === "owner" || tenantMembership?.tenant_role === "admin";
    const isSuperAdmin = !!superAdmin || userData.user.email?.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL;
    const isPlatformAdmin = !!platformAdmin || isSuperAdmin;

    if (!action) {
      return reply({ error: "Unknown action", received: body?.action ?? null }, 400);
    }

    if (action === "list" && !isTenantMember && !isPlatformAdmin) {
      return reply({ error: "Only workspace members can view staff" }, 403);
    }

    if (action !== "list" && !hasStaffManagerRole && !isTenantAdmin && !isPlatformAdmin) {
      return reply({ error: "Only admins or managers can manage staff" }, 403);
    }

    if (action === "list") {
      const { data: list, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (error) return reply({ error: error.message }, 500);
      const ids = list.users.map((u) => u.id);
      const [{ data: profiles }, { data: roles }, { data: pins }, { data: tenantMembers }, { data: platformAdmins }, { data: superAdmins }, { data: compensationRows }, { data: faceEnrollments }] = await Promise.all([
        admin.from("profiles").select("user_id,name").in("user_id", ids),
        admin.from("user_roles").select("user_id,role").eq("tenant_id", tenantId).in("user_id", ids),
        admin.from("staff_pins").select("user_id,phone").eq("tenant_id", tenantId).in("user_id", ids),
        admin.from("tenant_members").select("user_id").eq("tenant_id", tenantId).in("user_id", ids),
        admin.from("platform_admins").select("user_id").in("user_id", ids),
        admin.from("super_admins").select("user_id").in("user_id", ids),
        admin.from("staff_compensation").select("user_id,pay_type,base_rate,busy_day_rate,quiet_day_rate").eq("tenant_id", tenantId),
        admin.from("staff_face_enrollments").select("tenant_id,user_id,image_url").eq("tenant_id", tenantId).eq("is_active", true).in("user_id", ids),
      ]);
      const pMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p.name]));
      const pinMap = new Map((pins ?? []).map((p: any) => [p.user_id, p.phone]));
      const superAdminIds = new Set<string>((superAdmins ?? []).map((s: any) => s.user_id));
      list.users.forEach((u) => {
        if (u.email?.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL) superAdminIds.add(u.id);
      });
      const globalAdminIds = new Set<string>([
        ...(platformAdmins ?? []).map((p: any) => p.user_id),
        ...superAdminIds,
      ]);
      const enrollmentBelongsToUser = (e: any) => {
        if (!e?.user_id || !e?.image_url) return false;
        const clean = String(e.image_url).replace(/^.*attendance-selfies\//, "");
        return clean.startsWith(`${e.user_id}/`) || clean.startsWith(`${tenantId}/${e.user_id}/`);
      };
      const enrolledFaceIds = new Set<string>((faceEnrollments ?? [])
        .filter(enrollmentBelongsToUser)
        .map((e: any) => e.user_id));
      // Super admins must never appear as workspace staff — scrub any stale
      // tenant_members or user_roles rows for them.
      if (superAdminIds.size > 0) {
        const ids = Array.from(superAdminIds);
        await Promise.all([
          admin.from("user_roles").delete().eq("tenant_id", tenantId).in("user_id", ids),
          admin.from("tenant_members").delete().eq("tenant_id", tenantId).in("user_id", ids),
        ]);
      }
      if (globalAdminIds.size > 0) {
        await admin
          .from("user_roles")
          .delete()
          .eq("tenant_id", tenantId)
          .in("user_id", Array.from(globalAdminIds))
          .neq("role", "admin");
      }
      const tenantUserIds = new Set<string>([
        ...(tenantMembers ?? []).map((m: any) => m.user_id).filter((id: string) => !superAdminIds.has(id)),
        ...(roles ?? []).map((r: any) => r.user_id).filter((id: string) => !superAdminIds.has(id)),
      ]);
      const rMap = new Map<string, string[]>();
      (roles ?? []).forEach((r: any) => {
        const arr = rMap.get(r.user_id) ?? [];
        arr.push(r.role);
        rMap.set(r.user_id, arr);
      });
      const users = list.users.filter((u) => tenantUserIds.has(u.id) && !superAdminIds.has(u.id)).map((u) => {

        const userRoles = rMap.get(u.id) ?? [];
        return {
          id: u.id,
          email: u.email ?? "",
          name: pMap.get(u.id) ?? (u.user_metadata?.name as string) ?? "",
          role: globalAdminIds.has(u.id) || u.email?.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL
            ? "admin"
            : ROLE_PRIORITY.find((p) => userRoles.includes(p)) ?? null,
          roles: userRoles,
          is_global_admin: globalAdminIds.has(u.id) || u.email?.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL,
          is_super_admin: superAdminIds.has(u.id),
          phone: pinMap.get(u.id) ?? null,
          has_pin: pinMap.has(u.id),
          has_face_enrollment: enrolledFaceIds.has(u.id),
          email_confirmed: !!(u.email_confirmed_at || u.confirmed_at || u.last_sign_in_at),
          created_at: u.created_at,
        };
      });
      return reply({ users, compensation_rows: compensationRows ?? [] });
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
      const [{ data: targetPlatformAdmin }, { data: targetSuperAdmin }, targetAuthRes] = await Promise.all([
        admin.from("platform_admins").select("user_id").eq("user_id", user_id).maybeSingle(),
        admin.from("super_admins").select("user_id").eq("user_id", user_id).maybeSingle(),
        admin.auth.admin.getUserById(user_id),
      ]);
      if (targetPlatformAdmin || targetSuperAdmin || targetAuthRes?.data?.user?.email?.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL) {
        return reply({ error: "Global admin roles cannot be changed from Workers" }, 400);
      }
      await admin.from("user_roles").delete().eq("user_id", user_id).eq("tenant_id", tenantId);
      const { error } = await admin
        .from("user_roles")
        .insert({ user_id, role, tenant_id: tenantId });
      if (error) return reply({ error: error.message }, 500);
      return reply({ success: true });
    }

    if (action === "save_compensation") {
      const { user_id } = body ?? {};
      const payType = String(body?.pay_type ?? "salary");
      if (!user_id || !["salary", "wage", "weekly"].includes(payType)) {
        return reply({ error: "Invalid compensation input" }, 400);
      }
      const [{ data: targetMember }, { data: targetRole }] = await Promise.all([
        admin.from("tenant_members").select("user_id").eq("tenant_id", tenantId).eq("user_id", user_id).maybeSingle(),
        admin.from("user_roles").select("user_id").eq("tenant_id", tenantId).eq("user_id", user_id).maybeSingle(),
      ]);
      if (!targetMember && !targetRole) {
        return reply({ error: "Worker is not part of this workspace" }, 400);
      }
      const amount = (value: unknown) => {
        const n = Number(value ?? 0);
        return Number.isFinite(n) ? n : 0;
      };
      const { error } = await admin
        .from("staff_compensation")
        .upsert(
          {
            tenant_id: tenantId,
            user_id,
            pay_type: payType,
            base_rate: amount(body?.base_rate),
            busy_day_rate: amount(body?.busy_day_rate),
            quiet_day_rate: amount(body?.quiet_day_rate),
            updated_at: new Date().toISOString(),
            updated_by: callerId,
          },
          { onConflict: "tenant_id,user_id" },
        );
      if (error) return reply({ error: error.message }, 500);
      return reply({ success: true });
    }

    if (action === "enroll_face") {
      const { target_user_id } = body ?? {};
      const imageDataUrl = body?.image_data_url;
      if (!target_user_id || !imageDataUrl) {
        return reply({ error: "Missing target_user_id or image_data_url" }, 400);
      }
      const [{ data: targetMember }, { data: targetRole }] = await Promise.all([
        admin.from("tenant_members").select("user_id").eq("tenant_id", tenantId).eq("user_id", target_user_id).maybeSingle(),
        admin.from("user_roles").select("user_id").eq("tenant_id", tenantId).eq("user_id", target_user_id).maybeSingle(),
      ]);
      if (!targetMember && !targetRole) {
        return reply({ error: "Worker is not part of this workspace" }, 400);
      }
      const { bytes, contentType } = dataUrlToBytes(String(imageDataUrl));
      const ext = contentType.includes("png") ? "png" : "jpg";
      const image_url = `${tenantId}/${target_user_id}/enroll-${Date.now()}.${ext}`;
      const { error: uploadError } = await admin.storage
        .from("attendance-selfies")
        .upload(image_url, bytes, { contentType, upsert: false });
      if (uploadError) return reply({ error: uploadError.message }, 500);

      const { data: existingActive, error: existingError } = await admin
        .from("staff_face_enrollments")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("user_id", target_user_id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingError) return reply({ error: existingError.message }, 500);

      let enrollment: any = null;
      if (existingActive?.id) {
        const { data: updated, error: updateError } = await admin
          .from("staff_face_enrollments")
          .update({ image_url, enrolled_by: callerId, is_active: true, created_at: new Date().toISOString() })
          .eq("id", existingActive.id)
          .select("*")
          .single();
        if (updateError) return reply({ error: updateError.message }, 500);
        enrollment = updated;
      } else {
        const { data: inserted, error: insertError } = await admin.from("staff_face_enrollments").insert({
          tenant_id: tenantId,
          user_id: target_user_id,
          image_url,
          enrolled_by: callerId,
          is_active: true,
        }).select("*").single();
        if (insertError) return reply({ error: insertError.message }, 500);
        enrollment = inserted;
      }

      await admin
        .from("staff_face_enrollments")
        .update({ is_active: false })
        .eq("user_id", target_user_id)
        .eq("tenant_id", tenantId)
        .neq("id", enrollment.id);
      await admin
        .from("staff_face_enrollments")
        .update({ is_active: false })
        .eq("tenant_id", tenantId)
        .eq("image_url", image_url)
        .neq("user_id", target_user_id);
      return reply({ success: true, enrollment });
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

    if (action === "resend_verification") {
      const { user_id } = body ?? {};
      if (!user_id) return reply({ error: "Missing user_id" }, 400);
      const { data: target, error: getErr } = await admin.auth.admin.getUserById(user_id);
      if (getErr || !target?.user) return reply({ error: getErr?.message ?? "User not found" }, 404);
      if (target.user.email_confirmed_at) {
        return reply({ error: "User is already verified" }, 400);
      }
      const email = target.user.email;
      if (!email) return reply({ error: "User has no email" }, 400);

      const redirectTo = body?.redirect_to ?? req.headers.get("origin") ?? undefined;
      const publicAuthClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: resendErr } = await publicAuthClient.auth.resend({
        type: "signup",
        email,
        options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
      });
      if (resendErr) return reply({ error: resendErr.message }, 500);
      return reply({ success: true, email_sent: true });
    }

    return reply({ error: "Unknown action" }, 400);


  } catch (err) {
    return reply({ error: (err as Error).message }, 500);
  }
});
