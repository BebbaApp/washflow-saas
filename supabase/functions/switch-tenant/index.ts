// Switch the caller's active tenant by writing app_metadata.active_tenant_id.
// Client should call supabase.auth.refreshSession() after success so the new
// JWT claim is picked up by RLS (current_tenant_id() reads it).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const BodySchema = z.object({ tenant_id: z.string().uuid() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
    if (claimsErr || !claimsData?.claims?.sub) {
      console.error("getClaims failed", claimsErr);
      return json({ error: "Unauthorized" }, 401);
    }
    const user = { id: claimsData.claims.sub as string, app_metadata: (claimsData.claims as any).app_metadata ?? {} };

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { tenant_id } = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    const [{ data: membership }, { data: sadmin }] = await Promise.all([
      admin.from("tenant_members").select("tenant_id")
        .eq("tenant_id", tenant_id).eq("user_id", user.id).maybeSingle(),
      admin.from("super_admins").select("user_id")
        .eq("user_id", user.id).maybeSingle(),
    ]);
    if (!membership && !sadmin) return json({ error: "You are not a member of that workspace" }, 403);

    const newAppMeta = { ...(user.app_metadata ?? {}), active_tenant_id: tenant_id };
    const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: newAppMeta,
    });
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ ok: true, tenant_id }, 200);
  } catch (err) {
    console.error("switch-tenant error", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
