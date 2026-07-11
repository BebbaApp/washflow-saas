const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const BOOTSTRAP_SUPER_ADMIN_EMAIL = "postfastbiz@gmail.com";

const ServicePatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  price: z.coerce.number().min(0).max(999_999).optional(),
  duration: z.string().trim().max(80).optional(),
  features: z.array(z.string().trim().max(300)).max(80).optional(),
  popular: z.boolean().optional(),
  vat_exempt: z.boolean().optional(),
  sort_order: z.number().int().min(-999_999).max(999_999).optional(),
});

const ServiceCreateSchema = ServicePatchSchema.extend({
  name: z.string().trim().min(1).max(120),
});

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    tenant_id: z.string().uuid(),
    service: ServiceCreateSchema,
  }),
  z.object({
    action: z.literal("update"),
    tenant_id: z.string().uuid(),
    service_id: z.string().uuid(),
    service: ServicePatchSchema,
  }),
  z.object({
    action: z.literal("delete"),
    tenant_id: z.string().uuid(),
    service_id: z.string().uuid(),
  }),
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing Authorization" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) return json({ error: "Unauthorized" }, 401);

    const callerId = claimsData.claims.sub as string;
    const callerEmail = (claimsData.claims.email as string | undefined) ?? "";
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

    const body = parsed.data;
    const admin = createClient(supabaseUrl, serviceKey);

    const allowed = await canManageServices(admin, body.tenant_id, callerId, callerEmail);
    if (!allowed.ok) return json({ error: allowed.error }, allowed.status);

    if (body.action === "create") {
      const { data, error } = await admin
        .from("services")
        .insert({ tenant_id: body.tenant_id, ...body.service })
        .select("*")
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ service: data });
    }

    if (body.action === "update") {
      if (Object.keys(body.service).length === 0) return json({ error: "No service changes supplied" }, 400);
      const { data, error } = await admin
        .from("services")
        .update(body.service)
        .eq("tenant_id", body.tenant_id)
        .eq("id", body.service_id)
        .select("*")
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "Service not found" }, 404);
      return json({ service: data });
    }

    const { data, error } = await admin
      .from("services")
      .delete()
      .eq("tenant_id", body.tenant_id)
      .eq("id", body.service_id)
      .select("*")
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "Service not found" }, 404);
    return json({ service: data });
  } catch (err) {
    console.error("manage-service error", err);
    return json({ error: (err as Error).message }, 500);
  }
});

async function canManageServices(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  callerId: string,
  callerEmail: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [{ data: tenant }, { data: membership }, { data: roles }, { data: platformAdmin }, { data: superAdmin }] = await Promise.all([
    admin.from("tenants").select("status, grace_period_ends_at").eq("id", tenantId).maybeSingle(),
    admin.from("tenant_members").select("tenant_role").eq("tenant_id", tenantId).eq("user_id", callerId).maybeSingle(),
    admin.from("user_roles").select("role").eq("tenant_id", tenantId).eq("user_id", callerId),
    admin.from("platform_admins").select("user_id").eq("user_id", callerId).maybeSingle(),
    admin.from("super_admins").select("user_id").eq("user_id", callerId).maybeSingle(),
  ]);

  if (!tenant) return { ok: false, status: 404, error: "Workspace not found" };

  const status = (tenant as { status?: string }).status;
  const graceEndsAt = (tenant as { grace_period_ends_at?: string | null }).grace_period_ends_at;
  const licenseActive =
    status === "trialing" ||
    status === "active" ||
    (status === "past_due" && !!graceEndsAt && new Date(graceEndsAt).getTime() > Date.now());
  if (!licenseActive) return { ok: false, status: 403, error: "Workspace license is not active" };

  const isGlobalAdmin = !!platformAdmin || !!superAdmin || callerEmail.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL;
  const tenantRole = (membership as { tenant_role?: string } | null)?.tenant_role;
  const isTenantAdmin = tenantRole === "owner" || tenantRole === "admin";
  const managerRoles = new Set(["admin", "manager", "supervisor", "cashier"]);
  const isStaffServiceAdmin = ((roles as Array<{ role: string }> | null) ?? []).some((r) => managerRoles.has(r.role));

  if (!membership && !isGlobalAdmin) return { ok: false, status: 403, error: "You are not a member of this workspace" };
  if (!isGlobalAdmin && !isTenantAdmin && !isStaffServiceAdmin) {
    return {
      ok: false,
      status: 403,
      error: `You do not have permission to manage services (tenant_role=${tenantRole ?? "none"}, roles=${((roles as Array<{ role: string }> | null) ?? []).map((r) => r.role).join(",") || "none"})`,
    };
  }
  return { ok: true };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}