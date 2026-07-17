import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import postgres from "npm:postgres@3";
import { z } from "npm:zod@3";

type SupabaseAdmin = ReturnType<typeof createClient<any>>;

const TABLES = ["orders", "expenses", "inventory_items", "inventory_transactions"] as const;
const OPS = ["insert", "update", "delete", "list"] as const;

const BodySchema = z.object({
  tenant_id: z.string().uuid(),
  table: z.enum(TABLES),
  op: z.enum(OPS),
  payload: z.record(z.unknown()).optional().default({}),
});

const uuid = z.string().uuid();
const nullableUuid = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().uuid().nullable().optional(),
);
const text = (max = 500) => z.string().trim().min(1).max(max);
const optionalText = (max = 500) => z.string().trim().max(max).nullable().optional();
const numberValue = z.coerce.number().finite();
const timestampText = z.string().trim().min(1).max(80);

const DeleteSchema = z.object({ id: uuid }).strip();

const OrderInsertSchema = z.object({
  id: uuid.optional(),
  order_number: z.string().trim().max(40).optional(),
  customer: text(180),
  customer_phone: optionalText(40),
  customer_id: nullableUuid,
  vehicle: text(180),
  plate: text(80),
  service: text(180),
  service_price: numberValue.min(0).optional(),
  discount: numberValue.min(0).optional(),
  status: z.enum(["waiting", "in-progress", "completed", "cancelled"]).optional(),
  notes: optionalText(1000),
  wait_minutes: numberValue.int().min(0).nullable().optional(),
  completed_at: timestampText.nullable().optional(),
  created_by: nullableUuid,
  created_at: timestampText.optional(),
  updated_at: timestampText.optional(),
}).strip();

// Accept the full order shape (all optional) on update so callers can send a
// merged row. sync-mutation heals missing-server-row cases by upserting.
const OrderUpdateSchema = OrderInsertSchema.partial().extend({ id: uuid }).strip();

const ExpenseInsertSchema = z.object({
  id: uuid.optional(),
  description: text(300),
  amount: numberValue.min(0),
  category: text(120),
  subcategory: optionalText(120),
  vendor: optionalText(180),
  notes: optionalText(1000),
  date: timestampText.optional(),
  created_by: nullableUuid,
  created_at: timestampText.optional(),
}).strip();

const ExpenseUpdateSchema = ExpenseInsertSchema.partial().extend({ id: uuid }).strip();

const InventoryItemInsertSchema = z.object({
  id: uuid.optional(),
  name: text(180),
  category: text(120),
  subtype: optionalText(120),
  preset_id: optionalText(120),
  unit: z.string().trim().max(40).optional(),
  quantity: numberValue.optional(),
  threshold: numberValue.min(0).optional(),
  recommended_min: numberValue.nullable().optional(),
  recommended_max: numberValue.nullable().optional(),
  unit_cost: numberValue.min(0).optional(),
  expense_category: optionalText(120),
  supplier_id: nullableUuid,
  pack_size: numberValue.min(0).nullable().optional(),
  created_at: timestampText.optional(),
  updated_at: timestampText.optional(),
}).strip();

const InventoryItemUpdateSchema = InventoryItemInsertSchema.partial().extend({ id: uuid }).strip();

const InventoryTxInsertSchema = z.object({
  id: uuid.optional(),
  item_id: nullableUuid,
  item_name: text(180),
  delta: numberValue,
  balance: numberValue,
  type: z.enum(["restock", "consume", "adjust"]),
  source: text(160),
  notes: optionalText(1000),
  flow: z.enum(["confirmed", "auto", "override", "manual", "undo"]).nullable().optional(),
  unit_cost: numberValue.nullable().optional(),
  total_cost: numberValue.nullable().optional(),
  expense_id: nullableUuid,
  created_at: timestampText.optional(),
}).strip();

const InventoryTxUpdateSchema = InventoryTxInsertSchema.partial().extend({ id: uuid }).strip();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing Authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Function is not configured" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    const sub = claimsData?.claims?.sub as string | undefined;
    const email = (claimsData?.claims?.email as string | undefined) ?? null;
    if (claimsErr || !sub) return json({ error: "Unauthorized" }, 401);
    const userData = { user: { id: sub, email } };

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);

    const { tenant_id, table, op, payload } = parsed.data;
    const admin = createClient(supabaseUrl, serviceKey);
    const userScoped = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    // Writes are authorized in this function first. Most tables then use the
    // service-role client so one bad RLS/JWT claim cannot poison the offline
    // queue. Order updates that intentionally edit protected fields still use
    // the user-scoped client because the database trigger audits auth.uid().
    const access = op === "list"
      ? await canReadTenant(admin, tenant_id, userData.user.id)
      : await canWriteTenant(admin, tenant_id, userData.user.id);
    if (!access.ok) return json({ error: access.error }, access.status);

    if (op === "list") {
      const rows: unknown[] = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const result = await admin
          .from(table)
          .select("*")
          .eq("tenant_id", tenant_id)
          .order(table === "orders" ? "created_at" : "id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (result.error) return json({ error: result.error.message }, 500);
        const batch = result.data ?? [];
        rows.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      return json({ ok: true, rows });
    }

    const clean = parsePayload(table, op, payload, tenant_id, userData.user.id);
    if (!clean.ok) return json({ error: clean.error }, 400);

    let { id, row } = clean.value;
    if (table === "orders" && op === "insert") {
      const existingNumber = typeof row.order_number === "string" ? row.order_number : "";
      if (!existingNumber || /^WO-/i.test(existingNumber)) {
        const { data: orderNumber, error: orderNumberError } = await admin.rpc("next_order_number");
        if (orderNumberError) return json({ error: orderNumberError.message }, 500);
        row = { ...row, order_number: orderNumber };
      }
    }
    let writeClient = admin;
    let result;
    if (op === "delete") {
      result = await writeClient
        .from(table)
        .delete()
        .eq("tenant_id", tenant_id)
        .eq("id", id)
        .select("*")
        .maybeSingle();
    } else if (op === "update") {
      let { id: _id, tenant_id: _tenant, ...patch } = row as Record<string, unknown>;
      if (Object.keys(patch).length === 0) return json({ error: "No changes supplied" }, 400);
      if (table === "orders") {
        const orderAccess = await canUpdateOrder(admin, tenant_id, userData.user.id, userData.user.email ?? null, patch, id);
        if (!orderAccess.ok) return json({ error: orderAccess.error }, orderAccess.status);
        patch = orderAccess.patch;
        if (Object.keys(patch).length === 0) return json({ ok: true, row: null, skipped: true });
        if (orderAccess.requiresUserContext) {
          if (!dbUrl) return json({ error: "Function is not configured for order approvals" }, 500);
          const row = await updateOrderWithAuthContext(dbUrl, tenant_id, id, userData.user.id, patch);
          return json({ ok: true, row });
        }
      }
      // Partial updates are intentional. If the target row no longer exists or
      // belongs to another workspace, treat the mutation as stale instead of
      // blocking every later outbox item behind it.
      result = await writeClient
        .from(table)
        .update(patch)
        .eq("tenant_id", tenant_id)
        .eq("id", id)
        .select("*")
        .maybeSingle();
    } else {
      result = await writeClient
        .from(table)
        .upsert(row, { onConflict: "id" })
        .select("*")
        .single();
    }

    if (result.error) return json({ error: result.error.message }, 500);
    return json({ ok: true, row: result.data ?? null });
  } catch (err) {
    console.error("sync-mutation error", err);
    return json({ error: (err as Error).message }, 500);
  }
});

async function canWriteTenant(
  admin: SupabaseAdmin,
  tenantId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [{ data: tenant }, { data: member }, { data: platformAdmin }, { data: superAdmin }] = await Promise.all([
    admin.from("tenants").select("status,grace_period_ends_at").eq("id", tenantId).maybeSingle(),
    admin.from("tenant_members").select("tenant_id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle(),
    admin.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    admin.from("super_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);

  if (!tenant) return { ok: false, status: 404, error: "Workspace not found" };
  if (!member && !platformAdmin && !superAdmin) {
    return { ok: false, status: 403, error: "You are not a member of this workspace" };
  }

  const status = (tenant as { status?: string }).status;
  const grace = (tenant as { grace_period_ends_at?: string | null }).grace_period_ends_at;
  const active =
    status === "trialing" ||
    status === "active" ||
    (status === "past_due" && !!grace && new Date(grace).getTime() > Date.now());
  if (!active) return { ok: false, status: 403, error: "Workspace license is not active" };
  return { ok: true };
}

async function canReadTenant(
  admin: SupabaseAdmin,
  tenantId: string,
  userId: string,
): Promise<{ ok: true; patch: Record<string, unknown>; requiresUserContext: boolean } | { ok: false; status: number; error: string }> {
  const [{ data: tenant }, { data: member }, { data: platformAdmin }, { data: superAdmin }] = await Promise.all([
    admin.from("tenants").select("id").eq("id", tenantId).maybeSingle(),
    admin.from("tenant_members").select("tenant_id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle(),
    admin.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    admin.from("super_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);

  if (!tenant) return { ok: false, status: 404, error: "Workspace not found" };
  if (!member && !platformAdmin && !superAdmin) {
    return { ok: false, status: 403, error: "You are not a member of this workspace" };
  }
  return { ok: true };
}

async function canUpdateOrder(
  admin: SupabaseAdmin,
  tenantId: string,
  userId: string,
  userEmail: string | null,
  patch: Record<string, unknown>,
  orderId: string,
): Promise<{ ok: true; patch: Record<string, unknown>; requiresUserContext: boolean } | { ok: false; status: number; error: string }> {
  const { data: existing, error: existingError } = await admin
    .from("orders")
    .select("customer,customer_id,customer_phone,plate,vehicle,service,service_price,notes,order_number,created_by,created_at,status")
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();
  if (existingError) return { ok: false, status: 500, error: existingError.message };
  // Missing server rows are stale local mutations. Let the caller return OK so
  // the outbox can continue draining instead of getting stuck forever.
  if (!existing) return { ok: true, patch, requiresUserContext: false };

  const [{ data: roles }, { data: membership }, { data: platformAdmin }, { data: superAdmin }] = await Promise.all([
    admin.from("user_roles").select("role,tenant_id").eq("user_id", userId),
    admin.from("tenant_members").select("tenant_role").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle(),
    admin.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    admin.from("super_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);

  const roleSet = new Set(
    (roles ?? [])
      .filter((r: any) => !r.tenant_id || r.tenant_id === tenantId)
      .map((r: any) => r.role as string),
  );
  const tenantRole = (membership as { tenant_role?: string } | null)?.tenant_role;
  const isGlobalAdmin = !!platformAdmin || !!superAdmin || userEmail?.toLowerCase() === "postfastbiz@gmail.com";
  const isAdminLike = isGlobalAdmin || tenantRole === "owner" || tenantRole === "admin" || roleSet.has("admin");
  const canEditNotes = isAdminLike || roleSet.has("supervisor") || roleSet.has("manager") || roleSet.has("cashier");
  const canCancel = canEditNotes;
  const isFieldOnly = (roleSet.has("washer") || roleSet.has("driver")) && !canEditNotes;

  const changed = (column: string) => Object.prototype.hasOwnProperty.call(patch, column) && !sameValue((patch as any)[column], (existing as any)[column]);
  const pickAllowedOrderPatch = (allowed: string[]) => {
    const next: Record<string, unknown> = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
    }
    return next;
  };
  const changedKeys = Object.keys(patch).filter(changed);
  const protectedKeys = ["customer", "customer_id", "customer_phone", "plate", "vehicle", "service", "service_price", "notes", "order_number", "created_by", "created_at"];
  const statusOnlyPatch = pickAllowedOrderPatch(["status", "completed_at", "wait_minutes", "updated_at"]);

  if (isFieldOnly) {
    if (changed("status") && patch.status === "cancelled") {
      return { ok: false, status: 403, error: "Field staff cannot cancel orders." };
    }
    const hasAllowedStatusWork = Object.keys(statusOnlyPatch).length > 0;
    const onlyProtectedChanges = changedKeys.length > 0 && changedKeys.every((key) => protectedKeys.includes(key));
    if (!hasAllowedStatusWork && onlyProtectedChanges) {
      return { ok: false, status: 403, error: "Field staff cannot modify order details (only status/completion)." };
    }
    return { ok: true, patch: statusOnlyPatch, requiresUserContext: false };
  }

  if (changed("status") && patch.status === "cancelled" && !canCancel) {
    return { ok: false, status: 403, error: "You do not have permission to cancel orders." };
  }
  if (changed("notes") && !canEditNotes) {
    const withoutNotes = { ...patch };
    delete withoutNotes.notes;
    const hasOtherChange = Object.keys(withoutNotes).some(changed);
    if (!hasOtherChange) return { ok: false, status: 403, error: "You do not have permission to edit order notes." };
    return { ok: true, patch: withoutNotes, requiresUserContext: false };
  }
  const needsTriggerAuth = changed("notes") || (changed("status") && patch.status === "cancelled");
  if (needsTriggerAuth && canEditNotes) {
    const preferredRole = isAdminLike
      ? "admin"
      : roleSet.has("supervisor")
        ? "supervisor"
        : roleSet.has("manager")
          ? "manager"
          : "cashier";
    const ensured = await ensureAppRole(admin, tenantId, userId, preferredRole);
    if (!ensured.ok) return ensured;
  }
  return { ok: true, patch, requiresUserContext: needsTriggerAuth };
}

async function ensureAppRole(
  admin: SupabaseAdmin,
  tenantId: string,
  userId: string,
  role: "admin" | "supervisor" | "manager" | "cashier",
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: existing, error: existingError } = await admin
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", role)
    .maybeSingle();
  if (existingError) return { ok: false, status: 500, error: existingError.message };
  if (existing) return { ok: true };

  const { error: insertError } = await admin
    .from("user_roles")
    .insert({ user_id: userId, tenant_id: tenantId, role });
  if (insertError && insertError.code !== "23505") {
    return { ok: false, status: 500, error: insertError.message };
  }
  return { ok: true };
}

async function updateOrderWithAuthContext(
  dbUrl: string,
  tenantId: string,
  orderId: string,
  userId: string,
  patch: Record<string, unknown>,
) {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const row = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
      await tx`select set_config('request.jwt.claim.role', 'authenticated', true)`;

      const rows = await tx`
        update public.orders
        set
          customer = case when ${Object.prototype.hasOwnProperty.call(patch, "customer")} then ${patch.customer ?? null}::text else customer end,
          customer_id = case when ${Object.prototype.hasOwnProperty.call(patch, "customer_id")} then ${patch.customer_id ?? null}::uuid else customer_id end,
          customer_phone = case when ${Object.prototype.hasOwnProperty.call(patch, "customer_phone")} then ${patch.customer_phone ?? null}::text else customer_phone end,
          plate = case when ${Object.prototype.hasOwnProperty.call(patch, "plate")} then ${patch.plate ?? null}::text else plate end,
          vehicle = case when ${Object.prototype.hasOwnProperty.call(patch, "vehicle")} then ${patch.vehicle ?? null}::text else vehicle end,
          service = case when ${Object.prototype.hasOwnProperty.call(patch, "service")} then ${patch.service ?? null}::text else service end,
          service_price = case when ${Object.prototype.hasOwnProperty.call(patch, "service_price")} then ${patch.service_price ?? null}::numeric else service_price end,
          discount = case when ${Object.prototype.hasOwnProperty.call(patch, "discount")} then ${patch.discount ?? null}::numeric else discount end,
          status = coalesce(${patch.status ?? null}::text, status),
          notes = case when ${Object.prototype.hasOwnProperty.call(patch, "notes")} then ${patch.notes ?? null}::text else notes end,
          completed_at = case when ${Object.prototype.hasOwnProperty.call(patch, "completed_at")} then ${patch.completed_at ?? null}::timestamptz else completed_at end,
          wait_minutes = case when ${Object.prototype.hasOwnProperty.call(patch, "wait_minutes")} then ${patch.wait_minutes ?? null}::integer else wait_minutes end,
          pending_discount = case when ${Object.prototype.hasOwnProperty.call(patch, "pending_discount")} then ${patch.pending_discount ?? null}::jsonb else pending_discount end,
          updated_at = coalesce(${patch.updated_at ?? null}::timestamptz, now())
        where tenant_id = ${tenantId}::uuid
          and id = ${orderId}::uuid
        returning *
      `;
      return rows[0] ?? null;
    });
    return row;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

function sameValue(a: unknown, b: unknown) {
  if (a == null && b == null) return true;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}

function parsePayload(
  table: (typeof TABLES)[number],
  op: (typeof OPS)[number],
  payload: Record<string, unknown>,
  tenantId: string,
  userId: string,
): { ok: true; value: { id: string; row: Record<string, unknown> } } | { ok: false; error: unknown } {
  if (op === "delete") {
    const parsed = DeleteSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: parsed.error.flatten().fieldErrors };
    return { ok: true, value: { id: parsed.data.id, row: { id: parsed.data.id, tenant_id: tenantId } } };
  }

  const schema =
    table === "orders"
      ? op === "insert" ? OrderInsertSchema : OrderUpdateSchema
      : table === "expenses"
      ? op === "insert" ? ExpenseInsertSchema : ExpenseUpdateSchema
      : table === "inventory_items"
        ? op === "insert" ? InventoryItemInsertSchema : InventoryItemUpdateSchema
        : op === "insert" ? InventoryTxInsertSchema : InventoryTxUpdateSchema;

  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.flatten().fieldErrors };
  const id = (parsed.data as { id?: string }).id ?? crypto.randomUUID();
  const createdBy = (table === "expenses" || table === "orders") && op === "insert"
    ? { created_by: (parsed.data as { created_by?: string | null }).created_by ?? userId }
    : {};
  return {
    ok: true,
    value: {
      id,
      row: { ...parsed.data, ...createdBy, id, tenant_id: tenantId },
    },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}