const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const BOOTSTRAP_SUPER_ADMIN_EMAIL = "postfastbiz@gmail.com";

const BodySchema = z.object({
  tenant_id: z.string().uuid(),
  order_id: z.string().uuid(),
});

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
    const callerEmail = ((claimsData.claims.email as string | undefined) ?? "").toLowerCase();

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
    const { tenant_id, order_id } = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    // Permission: must be admin (app role) or tenant owner/admin or platform/super admin.
    const [{ data: roles }, { data: membership }, { data: platformAdmin }, { data: superAdmin }] = await Promise.all([
      admin.from("user_roles").select("role").eq("tenant_id", tenant_id).eq("user_id", callerId),
      admin.from("tenant_members").select("tenant_role").eq("tenant_id", tenant_id).eq("user_id", callerId).maybeSingle(),
      admin.from("platform_admins").select("user_id").eq("user_id", callerId).maybeSingle(),
      admin.from("super_admins").select("user_id").eq("user_id", callerId).maybeSingle(),
    ]);
    const isAppAdmin = ((roles as Array<{ role: string }> | null) ?? []).some((r) => r.role === "admin");
    const tRole = (membership as { tenant_role?: string } | null)?.tenant_role;
    const isTenantAdmin = tRole === "owner" || tRole === "admin";
    const isGlobalAdmin = !!platformAdmin || !!superAdmin || callerEmail === BOOTSTRAP_SUPER_ADMIN_EMAIL;
    if (!isAppAdmin && !isTenantAdmin && !isGlobalAdmin) {
      return json({ error: "Only admins can delete work orders." }, 403);
    }

    // Load the order.
    const { data: order, error: orderErr } = await admin
      .from("orders")
      .select("id, order_number, tenant_id, notes")
      .eq("id", order_id)
      .eq("tenant_id", tenant_id)
      .maybeSingle();
    if (orderErr) return json({ error: orderErr.message }, 500);
    if (!order) return json({ error: "Order not found" }, 404);
    if ((order.notes ?? "").includes("[DELETED")) {
      return json({ error: "Order is already deleted" }, 409);
    }

    const source = `Order ${order.order_number}`;

    // Fetch inventory transactions linked to this order.
    const { data: txs, error: txErr } = await admin
      .from("inventory_transactions")
      .select("id, item_id, item_name, delta, unit_cost, total_cost")
      .eq("tenant_id", tenant_id)
      .eq("source", source);
    if (txErr) return json({ error: txErr.message }, 500);

    // Group by item to compute net delta to reverse.
    const perItem = new Map<string, { name: string; delta: number }>();
    for (const t of (txs ?? []) as Array<{ item_id: string | null; item_name: string; delta: number }>) {
      if (!t.item_id) continue;
      const cur = perItem.get(t.item_id) ?? { name: t.item_name, delta: 0 };
      cur.delta += Number(t.delta) || 0;
      perItem.set(t.item_id, cur);
    }

    // Reverse each item: add back consumed quantity, insert reversing adjust tx.
    for (const [itemId, info] of perItem) {
      const { data: item, error: iErr } = await admin
        .from("inventory_items")
        .select("id, quantity")
        .eq("id", itemId)
        .eq("tenant_id", tenant_id)
        .maybeSingle();
      if (iErr || !item) continue;
      const reverseDelta = -info.delta; // if consumed (delta<0), reverse is positive
      const newQty = Math.max(0, Number(item.quantity) + reverseDelta);
      const { error: uErr } = await admin
        .from("inventory_items")
        .update({ quantity: newQty })
        .eq("id", itemId)
        .eq("tenant_id", tenant_id);
      if (uErr) return json({ error: uErr.message }, 500);

      const { error: insErr } = await admin.from("inventory_transactions").insert({
        tenant_id,
        item_id: itemId,
        item_name: info.name,
        type: "adjust",
        source: `Reversal ${order.order_number}`,
        notes: `Order ${order.order_number} deleted`,
        delta: reverseDelta,
        balance: newQty,
        flow: "manual",
      });
      if (insErr) return json({ error: insErr.message }, 500);
    }

    // Delete loyalty transactions linked to this order.
    await admin.from("loyalty_transactions").delete().eq("tenant_id", tenant_id).eq("order_id", order_id);

    // Soft-delete the order: mark cancelled + prepend a [DELETED <iso>] marker in notes.
    const stamp = new Date().toISOString();
    const marker = `[DELETED ${stamp}] Deleted by admin (${callerEmail || callerId}). Inventory and loyalty transactions reversed.`;
    const nextNotes = order.notes && order.notes.trim().length > 0
      ? `${marker}\n${order.notes}`
      : marker;
    const { error: updErr } = await admin
      .from("orders")
      .update({ status: "cancelled", notes: nextNotes })
      .eq("id", order_id)
      .eq("tenant_id", tenant_id);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ ok: true, reversed_items: perItem.size, reversed_transactions: txs?.length ?? 0 });
  } catch (err) {
    console.error("delete-order error", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
