// Invite a member to the caller's tenant. Owner/admin only.
// Creates a tenant_invitations row, emails the recipient via Resend
// (through the Lovable connector gateway), and returns the accept link
// for fallback / clipboard use.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3";

const BodySchema = z.object({
  tenant_id: z.string().uuid(),
  email: z.string().email(),
  tenant_role: z.enum(["owner", "admin", "member"]).default("member"),
  accept_url_base: z.string().url(),
});

const RESEND_API_URL = "https://api.resend.com";

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
    const inviter = userData.user;

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { tenant_id, email, tenant_role, accept_url_base } = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: membership } = await admin
      .from("tenant_members")
      .select("tenant_role")
      .eq("tenant_id", tenant_id)
      .eq("user_id", inviter.id)
      .maybeSingle();
    if (!membership || !["owner", "admin"].includes(membership.tenant_role)) {
      return json({ error: "Not authorized for this workspace" }, 403);
    }
    if (tenant_role === "owner" && membership.tenant_role !== "owner") {
      return json({ error: "Only owners can invite another owner" }, 403);
    }

    const lower = email.toLowerCase();

    const { data: tenant } = await admin
      .from("tenants").select("name").eq("id", tenant_id).maybeSingle();
    const tenantName = (tenant as any)?.name ?? "your workspace";

    const { data: invite, error: inviteErr } = await admin
      .from("tenant_invitations")
      .insert({ tenant_id, email: lower, tenant_role, invited_by: inviter.id })
      .select("id, token, expires_at")
      .single();
    if (inviteErr || !invite) return json({ error: inviteErr?.message ?? "Insert failed" }, 500);

    const accept_url = `${accept_url_base.replace(/\/+$/, "")}/accept-invite?token=${invite.token}`;

    // Audit
    await admin.from("membership_audit_log").insert({
      tenant_id,
      actor_user_id: inviter.id,
      actor_email: inviter.email,
      target_email: lower,
      action: "invite.created",
      to_role: tenant_role,
      payload: { invitation_id: invite.id },
    });

    // Email via Resend (gateway)
    let emailStatus: "sent" | "skipped" | "failed" = "skipped";
    let emailError: string | undefined;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (LOVABLE_API_KEY && RESEND_API_KEY) {
      try {
        const html = inviteEmailHtml({
          tenantName,
          inviterEmail: inviter.email ?? "A teammate",
          role: tenant_role,
          acceptUrl: accept_url,
          expiresAt: invite.expires_at,
        });
        const resp = await fetch(`${RESEND_GATEWAY}/emails`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": RESEND_API_KEY,
          },
          body: JSON.stringify({
            from: "Workspace invites <onboarding@resend.dev>",
            to: [lower],
            subject: `You're invited to join ${tenantName}`,
            html,
          }),
        });
        if (!resp.ok) {
          emailStatus = "failed";
          emailError = `Resend ${resp.status}: ${await resp.text()}`;
          console.error("invite email failed", emailError);
        } else {
          emailStatus = "sent";
        }
      } catch (e) {
        emailStatus = "failed";
        emailError = (e as Error).message;
        console.error("invite email exception", e);
      }
    }

    return json({
      id: invite.id,
      accept_url,
      expires_at: invite.expires_at,
      email_status: emailStatus,
      email_error: emailError,
    }, 200);
  } catch (err) {
    console.error("invite-member error", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function inviteEmailHtml(p: {
  tenantName: string; inviterEmail: string; role: string;
  acceptUrl: string; expiresAt: string;
}): string {
  const expires = new Date(p.expiresAt).toUTCString();
  return `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;">
    <div style="max-width:520px;margin:32px auto;background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e2e8f0;">
      <h1 style="margin:0 0 12px;font-size:20px;">You're invited to ${escapeHtml(p.tenantName)}</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#334155;">
        <strong>${escapeHtml(p.inviterEmail)}</strong> invited you to join
        <strong>${escapeHtml(p.tenantName)}</strong> as a <strong>${escapeHtml(p.role)}</strong>.
      </p>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#334155;">
        Sign in or create an account using <em>this email address</em>, then open the link below.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${p.acceptUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-size:14px;font-weight:600;">Accept invitation</a>
      </p>
      <p style="margin:0 0 8px;font-size:12px;color:#64748b;word-break:break-all;">
        Or paste this URL: <a href="${p.acceptUrl}" style="color:#0f172a;">${p.acceptUrl}</a>
      </p>
      <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;">This invitation expires on ${expires}.</p>
    </div>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
