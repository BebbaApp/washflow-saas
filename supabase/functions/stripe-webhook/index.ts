// Stripe webhook: flips tenant status and writes subscription/invoice rows.
// Configure in Stripe: endpoint URL = https://<project>.functions.supabase.co/stripe-webhook
// Events: checkout.session.completed, customer.subscription.updated,
//         customer.subscription.deleted, invoice.paid, invoice.payment_failed
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const stripeKey = Deno.env.get("STRIPE_SECRET_KEY")!;
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, webhookSecret);
  } catch (err) {
    console.error("Webhook signature invalid", err);
    return new Response(`Invalid signature: ${(err as Error).message}`, { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // Idempotency: bail if we've already processed this event id.
  const { error: dupErr } = await admin
    .from("processed_stripe_events")
    .insert({ stripe_event_id: event.id, event_type: event.type });
  if (dupErr) {
    // Postgres unique_violation = 23505
    if ((dupErr as { code?: string }).code === "23505") {
      console.log("Duplicate Stripe event ignored", event.id);
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("Failed to record event id", dupErr);
    // Don't block processing on insert errors other than dup
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = (session.metadata?.tenant_id ?? session.client_reference_id) as string | undefined;
        const planId = session.metadata?.plan_id as string | undefined;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (!tenantId) break;

        const update: Record<string, unknown> = {
          status: "active",
          grace_period_ends_at: null,
        };
        if (planId) update.plan_id = planId;
        if (customerId) update.stripe_customer_id = customerId;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          update.current_period_end = new Date(sub.current_period_end * 1000).toISOString();
          await upsertSubscription(admin, tenantId, sub, planId);
        }
        await admin.from("tenants").update(update).eq("id", tenantId);
        await logEvent(admin, tenantId, "checkout.completed", { session_id: session.id });
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId = (sub.metadata?.tenant_id ?? (await tenantIdFromCustomer(admin, sub.customer as string))) as string | undefined;
        if (!tenantId) break;
        const planId = sub.metadata?.plan_id as string | undefined;
        await upsertSubscription(admin, tenantId, sub, planId);

        const update: Record<string, unknown> = {
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        };
        if (sub.status === "active" || sub.status === "trialing") {
          update.status = "active";
          update.grace_period_ends_at = null;
        } else if (sub.status === "past_due" || sub.status === "unpaid") {
          update.status = "past_due";
          update.grace_period_ends_at = new Date(Date.now() + 7 * 86400_000).toISOString();
        } else if (sub.status === "canceled" || event.type === "customer.subscription.deleted") {
          update.status = "cancelled";
        }
        if (planId) update.plan_id = planId;
        await admin.from("tenants").update(update).eq("id", tenantId);
        await logEvent(admin, tenantId, event.type, { sub_id: sub.id, status: sub.status });
        break;
      }

      case "invoice.paid":
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const tenantId = await tenantIdFromCustomer(admin, inv.customer as string);
        if (!tenantId) break;

        await admin.from("invoices").upsert({
          tenant_id: tenantId,
          stripe_invoice_id: inv.id,
          amount_cents: inv.amount_paid || inv.amount_due || 0,
          currency: inv.currency ?? "usd",
          status: inv.status ?? event.type,
          due_date: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
          paid_at: inv.status_transitions?.paid_at
            ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
            : null,
          hosted_url: inv.hosted_invoice_url ?? null,
        }, { onConflict: "stripe_invoice_id" });

        if (event.type === "invoice.payment_failed") {
          await admin.from("tenants").update({
            status: "past_due",
            grace_period_ends_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
          }).eq("id", tenantId);
        }
        await logEvent(admin, tenantId, event.type, { invoice_id: inv.id });
        break;
      }

      default:
        // ignore other events
        break;
    }
  } catch (err) {
    console.error("Webhook handler error", err);
    return new Response(`Handler error: ${(err as Error).message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

async function tenantIdFromCustomer(admin: ReturnType<typeof createClient>, customerId: string) {
  if (!customerId) return undefined;
  const { data } = await admin.from("tenants").select("id").eq("stripe_customer_id", customerId).maybeSingle();
  return (data as { id: string } | null)?.id;
}

async function upsertSubscription(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  sub: Stripe.Subscription,
  planId: string | undefined,
) {
  await admin.from("subscriptions").upsert({
    tenant_id: tenantId,
    plan_id: planId ?? null,
    stripe_sub_id: sub.id,
    status: sub.status,
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "stripe_sub_id" });
}

async function logEvent(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  kind: string,
  payload: Record<string, unknown>,
) {
  await admin.from("license_events").insert({ tenant_id: tenantId, kind, payload });
}
