// Stripe Billing Portal session creator for tenant owners/admins.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { z } from "npm:zod@3";

const BodySchema = z.object({
  tenant_id: z.string().uuid(),
  return_url: z.string().url(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return json({ error: "Stripe is not configured" }, 500);

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
    const email = userData.user.email;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return json({ error: parsed.error.flatten().fieldErrors }, 400);
    }
    const { tenant_id, return_url } = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: membership } = await admin
      .from("tenant_members")
      .select("tenant_role")
      .eq("tenant_id", tenant_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership || !["owner", "admin"].includes(membership.tenant_role)) {
      return json({ error: "Not authorized for this workspace" }, 403);
    }

    const { data: tenant, error: tenantErr } = await admin
      .from("tenants")
      .select("id, name, stripe_customer_id")
      .eq("id", tenant_id)
      .maybeSingle();
    if (tenantErr || !tenant) return json({ error: "Tenant not found" }, 404);

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    let customerId = tenant.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email ?? undefined,
        name: tenant.name,
        metadata: { tenant_id: tenant.id },
      });
      customerId = customer.id;
      await admin.from("tenants").update({ stripe_customer_id: customerId }).eq("id", tenant.id);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url,
    });

    return json({ url: session.url }, 200);
  } catch (err) {
    console.error("create-billing-portal error", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
