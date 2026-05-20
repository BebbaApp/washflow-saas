// Switch the caller's active tenant by writing app_metadata.active_tenant_id.
// Client should call supabase.auth.refreshSession() after success so the new
// JWT claim is picked up by RLS (current_tenant_id() reads it).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const BodySchema = z.object({ tenant_id: z.string().uuid() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
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
    const user = userData.user;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { tenant_id } = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    const [{ data: membership }, { data: padmin }] = await Promise.all([
      admin.from("tenant_members").select("tenant_id")
        .eq("tenant_id", tenant_id).eq("user_id", user.id).maybeSingle(),
      admin.from("platform_admins").select("user_id")
        .eq("user_id", user.id).maybeSingle(),
    ]);
    if (!membership && !padmin) return json({ error: "You are not a member of that workspace" }, 403);

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
