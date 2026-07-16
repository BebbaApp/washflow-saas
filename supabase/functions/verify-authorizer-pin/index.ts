// Verify a manager/admin PIN inline for a privileged action (e.g. approving
// a discount) WITHOUT minting a new session. The caller (usually a cashier)
// stays signed in; we only return the authorizer's identity so the client
// can attach it to the action being authorized.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import bcrypt from "npm:bcryptjs@2.4.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const phoneVariants = (raw: string): string[] => {
  const cleaned = raw.trim().replace(/[\s\-().]/g, "");
  const digits = cleaned.replace(/^\+/, "").replace(/\D/g, "");
  const variants = new Set<string>();
  if (cleaned) variants.add(cleaned);
  if (digits) {
    variants.add(digits);
    variants.add(`+${digits}`);
  }
  if (digits.startsWith("0") && digits.length > 1) {
    const local = digits.slice(1);
    variants.add(local);
    variants.add(`27${local}`);
    variants.add(`+27${local}`);
  } else if (digits.startsWith("27") && digits.length > 2) {
    const local = digits.slice(2);
    variants.add(local);
    variants.add(`0${local}`);
  }
  return Array.from(variants);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await anon.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { identifier, pin, tenant_id, required_roles } = body ?? {};
    const rawId = String(identifier ?? "").trim();
    const pinStr = String(pin ?? "");
    const requiredRoles: string[] = Array.isArray(required_roles) && required_roles.length
      ? required_roles.map((r: any) => String(r))
      : ["admin", "manager"];

    if (!rawId || !/^\d{4,6}$/.test(pinStr)) {
      return new Response(
        JSON.stringify({ error: "Phone or email and 4-6 digit PIN required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!tenant_id || typeof tenant_id !== "string") {
      return new Response(JSON.stringify({ error: "tenant_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Ensure the caller belongs to the tenant they claim to authorize inside.
    const { data: callerMember } = await admin
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenant_id)
      .eq("user_id", callerId)
      .maybeSingle();
    if (!callerMember) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve the authorizer via staff_pins (phone or email), scoped to tenant.
    const isEmail = rawId.includes("@");
    let rec: { user_id: string; pin_hash: string } | null = null;
    let lookupDiag = "";

    if (isEmail) {
      const target = rawId.toLowerCase();
      const authAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { db: { schema: "auth" as any } },
      );
      const { data: userRow, error: userErr } = await authAdmin
        .from("users" as any)
        .select("id, email")
        .ilike("email", target)
        .maybeSingle();
      if (userErr) console.error("verify-authorizer-pin: auth lookup err", userErr);
      const foundUserId = (userRow as any)?.id ?? null;
      if (!foundUserId) {
        lookupDiag = "no_auth_user";
      } else {
        const { data } = await admin
          .from("staff_pins")
          .select("user_id, pin_hash")
          .eq("user_id", foundUserId)
          .eq("tenant_id", tenant_id)
          .maybeSingle();
        rec = data ?? null;
        if (!rec) lookupDiag = "user_has_no_pin_in_tenant";
      }
    } else {
      const variants = new Set(phoneVariants(rawId));
      const { data: pins, error: pinsErr } = await admin
        .from("staff_pins")
        .select("user_id, pin_hash, phone")
        .eq("tenant_id", tenant_id);
      if (pinsErr) console.error("verify-authorizer-pin: pins lookup err", pinsErr);
      const match = (pins ?? []).find((row: any) =>
        phoneVariants(String(row.phone ?? "")).some((k) => variants.has(k)),
      );
      rec = match ? { user_id: match.user_id, pin_hash: match.pin_hash } : null;
    }

    if (!rec) {
      return new Response(
        JSON.stringify({ error: "No PIN found for that phone or email." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!bcrypt.compareSync(pinStr, rec.pin_hash)) {
      return new Response(JSON.stringify({ error: "Invalid PIN" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Confirm the authorizer belongs to the tenant AND holds a required role.
    const { data: authorizerMember } = await admin
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenant_id)
      .eq("user_id", rec.user_id)
      .maybeSingle();
    if (!authorizerMember) {
      return new Response(JSON.stringify({ error: "Authorizer is not a member of this workspace." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", rec.user_id);
    const roles = (roleRows ?? []).map((r: any) => String(r.role));
    const matchedRole = roles.find((r) => requiredRoles.includes(r));
    if (!matchedRole) {
      return new Response(
        JSON.stringify({ error: "This user is not authorized to approve discounts." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("name")
      .eq("user_id", rec.user_id)
      .maybeSingle();

    let email: string | null = null;
    try {
      const { data: authUser } = await admin.auth.admin.getUserById(rec.user_id);
      email = authUser?.user?.email ?? null;
    } catch { /* ignore */ }

    return new Response(
      JSON.stringify({
        ok: true,
        user: {
          id: rec.user_id,
          name: (profile as any)?.name || email || "Manager",
          role: matchedRole,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
