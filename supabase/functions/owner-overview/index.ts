// Aggregate summary metrics for every workspace where the caller is
// owner/admin (or all workspaces if super_admin). Read-only.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const BodySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
}).default({});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    const uid = claims?.claims?.sub as string | undefined;
    if (claimsErr || !uid) return json({ error: "Unauthorized" }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const fromIso = parsed.data.from ?? monthStart;
    const toIso = parsed.data.to ?? now.toISOString();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: sa } = await admin.from("super_admins").select("user_id").eq("user_id", uid).maybeSingle();
    const isSuper = !!sa;

    let tenantIds: string[] = [];
    let rolesByTenant: Record<string, string> = {};
    if (isSuper) {
      const { data: all } = await admin.from("tenants").select("id");
      tenantIds = ((all ?? []) as any[]).map((r) => r.id);
      tenantIds.forEach((t) => { rolesByTenant[t] = "owner"; });
    } else {
      const { data: memb } = await admin
        .from("tenant_members")
        .select("tenant_id, tenant_role")
        .eq("user_id", uid)
        .in("tenant_role", ["owner", "admin"]);
      ((memb ?? []) as any[]).forEach((r) => {
        tenantIds.push(r.tenant_id);
        rolesByTenant[r.tenant_id] = r.tenant_role;
      });
    }
    if (tenantIds.length === 0) return json({ tenants: [], range: { from: fromIso, to: toIso } }, 200);

    const { data: tenants } = await admin
      .from("tenants")
      .select("id, name, slug, status, plan_id, trial_ends_at, grace_period_ends_at, current_period_end")
      .in("id", tenantIds);

    const results = await Promise.all(tenantIds.map(async (tid) => {
      const [ordersRes, ordersTodayRes, expensesRes, membersRes, activeRes, inventoryRes] = await Promise.all([
        admin.from("orders").select("id, service_price, status, wait_minutes, service, created_at")
          .eq("tenant_id", tid).gte("created_at", fromIso).lte("created_at", toIso),
        admin.from("orders").select("id, service_price")
          .eq("tenant_id", tid).gte("created_at", todayStart),
        admin.from("expenses").select("amount, expense_date")
          .eq("tenant_id", tid).gte("expense_date", fromIso.slice(0, 10)).lte("expense_date", toIso.slice(0, 10)),
        admin.from("tenant_members").select("user_id, tenant_role").eq("tenant_id", tid),
        admin.from("staff_active_status").select("user_id, is_active").eq("tenant_id", tid).eq("is_active", true),
        admin.from("inventory_items").select("id, current_stock, reorder_point").eq("tenant_id", tid),
      ]);

      const orders = (ordersRes.data ?? []) as any[];
      const ordersToday = (ordersTodayRes.data ?? []) as any[];
      const expenses = (expensesRes.data ?? []) as any[];
      const members = (membersRes.data ?? []) as any[];
      const active = (activeRes.data ?? []) as any[];
      const inventory = (inventoryRes.data ?? []) as any[];

      const revenue = orders.reduce((s, o) => s + Number(o.service_price || 0), 0);
      const completed = orders.filter((o) => o.status === "completed");
      const avgWait = completed.length
        ? Math.round(completed.reduce((s, o) => s + Number(o.wait_minutes || 0), 0) / completed.length)
        : 0;
      const svcCount: Record<string, number> = {};
      orders.forEach((o) => { if (o.service) svcCount[o.service] = (svcCount[o.service] ?? 0) + 1; });
      const topService = Object.entries(svcCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      return {
        tenant_id: tid,
        my_role: rolesByTenant[tid],
        revenue,
        expenses: expenses.reduce((s, e) => s + Number(e.amount || 0), 0),
        orders_count: orders.length,
        completed_count: completed.length,
        avg_wait_minutes: avgWait,
        top_service: topService,
        today_revenue: ordersToday.reduce((s, o) => s + Number(o.service_price || 0), 0),
        today_orders: ordersToday.length,
        workers_total: members.length,
        workers_on_shift: active.length,
        inventory_low: inventory.filter((i) => Number(i.current_stock ?? 0) <= Number(i.reorder_point ?? 0)).length,
      };
    }));

    const tenantsById = new Map(((tenants ?? []) as any[]).map((t) => [t.id, t]));
    const merged = results.map((r) => ({ ...tenantsById.get(r.tenant_id), ...r }));

    return json({ tenants: merged, range: { from: fromIso, to: toIso } }, 200);
  } catch (e) {
    console.error("owner-overview error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
