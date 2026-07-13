import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

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
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Function is not configured" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);

    const { tenant_id, table, op, payload } = parsed.data;
    const admin = createClient(supabaseUrl, serviceKey);
    // NOTE: We use the service-role `admin` client for writes to bypass RLS.
    // The edge function already validated tenant membership above via
    // canWriteTenant, and the orders trigger is updated to trust the
    // service-role context (auth.uid() null => edge-authorized).
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
    const writeClient = table === "orders" ? userScopedAdmin : admin;
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
      const { id: _id, tenant_id: _tenant, ...patch } = row as Record<string, unknown>;
      if (Object.keys(patch).length === 0) return json({ error: "No changes supplied" }, 400);
      // Try a scoped UPDATE first. If no row matches (returning null with no
      // error), the local mirror has a row the server never saw — heal it by
      // upserting the merged row so status/notes changes don't get stuck.
      const upd = await writeClient
        .from(table)
        .update(patch)
        .eq("tenant_id", tenant_id)
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (!upd.error && !upd.data) {
        result = await writeClient
          .from(table)
          .upsert(row, { onConflict: "id" })
          .select("*")
          .single();
      } else {
        result = upd;
      }
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
  admin: ReturnType<typeof createClient>,
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
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
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