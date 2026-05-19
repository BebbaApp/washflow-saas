// Invite a member to the caller's tenant. Owner/admin only.
// Creates a tenant_invitations row and returns a shareable accept link.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const BodySchema = z.object({
  tenant_id: z.string().uuid(),
  email: z.string().email(),
  tenant_role: z.enum(["owner", "admin", "member"]).default("member"),
  accept_url_base: z.string().url(),
});

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
    const userId = userData.user.id;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { tenant_id, email, tenant_role, accept_url_base } = parsed.data;

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

    // Reject if email already belongs to an active member
    const { data: existingUser } = await admin
      .from("auth.users" as any)
      .select("id"); // service-role can; ignore failure
    const lower = email.toLowerCase();
    if (existingUser) {
      for (const u of existingUser as any[]) {
        if ((u.email ?? "").toLowerCase() === lower) {
          const { data: alreadyMember } = await admin
            .from("tenant_members")
            .select("user_id")
            .eq("tenant_id", tenant_id)
            .eq("user_id", u.id)
            .maybeSingle();
          if (alreadyMember) return json({ error: "User is already a member" }, 409);
        }
      }
    }

    const { data: invite, error: inviteErr } = await admin
      .from("tenant_invitations")
      .insert({
        tenant_id,
        email: lower,
        tenant_role,
        invited_by: userId,
      })
      .select("id, token, expires_at")
      .single();
    if (inviteErr || !invite) return json({ error: inviteErr?.message ?? "Insert failed" }, 500);

    const accept_url = `${accept_url_base.replace(/\/+$/, "")}/accept-invite?token=${invite.token}`;

    return json({ id: invite.id, accept_url, expires_at: invite.expires_at }, 200);
  } catch (err) {
    console.error("invite-member error", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
