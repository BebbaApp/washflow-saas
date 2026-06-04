// Accept a tenant invite by token. Authenticated user joins the tenant.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const BodySchema = z.object({ token: z.string().min(8) });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Sign in first" }, 401);

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
    const { token } = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: invite } = await admin
      .from("tenant_invitations")
      .select("id, tenant_id, email, tenant_role, expires_at, accepted_at")
      .eq("token", token)
      .maybeSingle();
    if (!invite) return json({ error: "Invite not found" }, 404);
    if (invite.accepted_at) return json({ error: "Invite already used" }, 410);
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return json({ error: "Invite expired" }, 410);
    }
    if ((user.email ?? "").toLowerCase() !== invite.email.toLowerCase()) {
      return json({ error: `This invite is for ${invite.email}` }, 403);
    }

    // Insert membership (ignore if already exists)
    const { error: memberErr } = await admin
      .from("tenant_members")
      .upsert(
        { tenant_id: invite.tenant_id, user_id: user.id, tenant_role: invite.tenant_role },
        { onConflict: "tenant_id,user_id" }
      );
    if (memberErr) return json({ error: memberErr.message }, 500);

    await admin
      .from("tenant_invitations")
      .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
      .eq("id", invite.id);

    await admin
      .from("license_events")
      .insert({ tenant_id: invite.tenant_id, kind: "member.invite_accepted", payload: { user_id: user.id, email: user.email } });

    await admin.from("membership_audit_log").insert({
      tenant_id: invite.tenant_id,
      actor_user_id: user.id,
      actor_email: user.email,
      target_user_id: user.id,
      target_email: user.email,
      action: "invite.accepted",
      to_role: invite.tenant_role,
      payload: { invitation_id: invite.id },
    });

    return json({ ok: true, tenant_id: invite.tenant_id }, 200);
  } catch (err) {
    console.error("accept-invite error", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
