// Resync a tenant's billing state from Stripe (platform admin only).
// Pulls live subscription + recent invoices for the tenant's stripe_customer_id
// and upserts them locally, then sets tenant.status from the subscription.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { z } from "npm:zod@3";

const BodySchema = z.object({ tenant_id: z.string().uuid() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return json({ error: "Stripe not configured" }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { tenant_id } = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: isAdmin } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!isAdmin) return json({ error: "Platform admin required" }, 403);

    const { data: tenant } = await admin
      .from("tenants")
      .select("id, stripe_customer_id")
      .eq("id", tenant_id)
      .maybeSingle();
    if (!tenant) return json({ error: "Tenant not found" }, 404);
    if (!tenant.stripe_customer_id) {
      return json({ error: "Tenant has no stripe_customer_id" }, 400);
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    // Fetch subscriptions for the customer
    const subs = await stripe.subscriptions.list({
      customer: tenant.stripe_customer_id,
      status: "all",
      limit: 10,
      expand: ["data.items.data.price"],
    });

    // Pick the most relevant (active > trialing > past_due > newest)
    const priority: Record<string, number> = { active: 5, trialing: 4, past_due: 3, unpaid: 2 };
    const active = [...subs.data].sort((a, b) => {
      const ap = priority[a.status] ?? 1;
      const bp = priority[b.status] ?? 1;
      if (ap !== bp) return bp - ap;
      return b.created - a.created;
    })[0];

    let summary: Record<string, unknown> = {
      tenant_id,
      subscriptions_found: subs.data.length,
    };

    for (const sub of subs.data) {
      const planId = (sub.metadata?.plan_id as string | undefined) ?? null;
      await admin.from("subscriptions").upsert({
        tenant_id,
        plan_id: planId,
        stripe_sub_id: sub.id,
        status: sub.status,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "stripe_sub_id" });
    }

    if (active) {
      const update: Record<string, unknown> = {
        current_period_end: new Date(active.current_period_end * 1000).toISOString(),
      };
      if (active.status === "active" || active.status === "trialing") {
        update.status = "active";
        update.grace_period_ends_at = null;
      } else if (active.status === "past_due" || active.status === "unpaid") {
        update.status = "past_due";
        update.grace_period_ends_at = new Date(Date.now() + 7 * 86400_000).toISOString();
      } else if (active.status === "canceled") {
        update.status = "cancelled";
      }
      const planId = active.metadata?.plan_id as string | undefined;
      if (planId) update.plan_id = planId;
      await admin.from("tenants").update(update).eq("id", tenant_id);
      summary.applied_status = update.status;
      summary.active_sub_id = active.id;
    }

    // Pull last 25 invoices and upsert
    const invs = await stripe.invoices.list({ customer: tenant.stripe_customer_id, limit: 25 });
    for (const inv of invs.data) {
      await admin.from("invoices").upsert({
        tenant_id,
        stripe_invoice_id: inv.id,
        amount_cents: inv.amount_paid || inv.amount_due || 0,
        currency: inv.currency ?? "usd",
        status: inv.status ?? "unknown",
        due_date: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
        paid_at: inv.status_transitions?.paid_at
          ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
          : null,
        hosted_url: inv.hosted_invoice_url ?? null,
      }, { onConflict: "stripe_invoice_id" });
    }
    summary.invoices_synced = invs.data.length;

    await admin.from("license_events").insert({
      tenant_id,
      kind: "manual.resync",
      payload: { ...summary, by_user: userId },
    });

    return json({ ok: true, summary }, 200);
  } catch (err) {
    console.error("resync-tenant-billing error", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
