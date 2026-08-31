// apply-free-wash — service-role redemption of a loyalty free wash.
// Client-side inserts fail when the caller's active_tenant_id JWT claim is
// stale (RLS: "new row violates row-level security policy for table customers").
// This function verifies tenant membership server-side, then performs the
// customer upsert, the loyalty redemption row and the order price zeroing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return reply({ error: "missing_auth" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: userData, error: uErr } = await userClient.auth.getUser();
  if (uErr || !userData?.user) return reply({ error: "invalid_session" }, 401);
  const caller = userData.user;

  let body: any;
  try { body = await req.json(); } catch { return reply({ error: "invalid_json" }, 400); }

  const tenant_id = String(body?.tenant_id ?? "");
  const order_id = String(body?.order_id ?? "");
  const points = Number(body?.points ?? 100);
  if (!tenant_id || !order_id) return reply({ error: "missing_fields" }, 400);

  const admin = createClient(url, service);

  const [{ data: member }, { data: platform }, { data: superAdm }] = await Promise.all([
    admin.from("tenant_members").select("user_id").eq("tenant_id", tenant_id).eq("user_id", caller.id).maybeSingle(),
    admin.from("platform_admins").select("user_id").eq("user_id", caller.id).maybeSingle(),
    admin.from("super_admins").select("user_id").eq("user_id", caller.id).maybeSingle(),
  ]);
  if (!member && !platform && !superAdm) return reply({ error: "not_authorized" }, 403);

  const { data: order, error: oErr } = await admin
    .from("orders")
    .select("id, tenant_id, customer, customer_phone, order_number, service_price, discount")
    .eq("id", order_id)
    .eq("tenant_id", tenant_id)
    .maybeSingle();
  if (oErr) return reply({ error: oErr.message }, 500);
  if (!order) return reply({ error: "order_not_found" }, 404);

  // Already redeemed for this order? Idempotent success.
  const { data: existingTxn } = await admin
    .from("loyalty_transactions")
    .select("id")
    .eq("tenant_id", tenant_id)
    .eq("order_id", order_id)
    .eq("type", "redeemed")
    .maybeSingle();

  if (!existingTxn) {
    // Resolve / create the customer record.
    let customerId: string | null = null;
    const phone = digits(order.customer_phone).slice(-9);
    const name = String(order.customer ?? "").trim();

    const { data: customers } = await admin
      .from("customers")
      .select("id, name, phone")
      .eq("tenant_id", tenant_id);
    for (const c of customers ?? []) {
      if (phone && digits(c.phone).slice(-9) === phone) { customerId = c.id; break; }
    }
    if (!customerId && name) {
      const lower = name.toLowerCase();
      const hit = (customers ?? []).find((c) => String(c.name ?? "").trim().toLowerCase() === lower);
      if (hit) customerId = hit.id;
    }
    if (!customerId) {
      const { data: created, error: cErr } = await admin
        .from("customers")
        .insert({ tenant_id, name: name || "Walk-in", phone: order.customer_phone || null })
        .select("id")
        .single();
      if (cErr || !created) return reply({ error: cErr?.message ?? "customer_create_failed" }, 500);
      customerId = created.id;
    }

    const actor = (caller.user_metadata as any)?.name || caller.email || "staff";
    const { error: tErr } = await admin.from("loyalty_transactions").insert({
      tenant_id,
      customer_id: customerId,
      order_id,
      points: Math.abs(points) || 100,
      type: "redeemed",
      description: `Free wash applied on order ${order.order_number} by ${actor}`,
    });
    if (tErr && (tErr as any).code !== "23505") return reply({ error: tErr.message }, 500);
  }

  // Zero out the order's revenue: move remaining price into discount.
  const currentPrice = Number(order.service_price ?? 0) || 0;
  const currentDiscount = Number(order.discount ?? 0) || 0;
  if (currentPrice > 0) {
    const { error: uErr2 } = await admin
      .from("orders")
      .update({
        service_price: 0,
        discount: +(currentDiscount + currentPrice).toFixed(2),
        updated_at: new Date().toISOString(),
      })
      .eq("id", order_id)
      .eq("tenant_id", tenant_id);
    if (uErr2) return reply({ error: uErr2.message }, 500);
  }

  return reply({ ok: true });
});
