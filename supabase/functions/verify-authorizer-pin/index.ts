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

const safeComparePin = (pin: string, hash: unknown): boolean => {
  if (typeof hash !== "string") return false;
  const trimmedHash = hash.trim();
  if (!trimmedHash) return false;

  // bcryptjs accepts the hashes this app creates. Some imported/legacy bcrypt
  // hashes can use $2y$/$2b$ prefixes, so retry with the widely-supported $2a$
  // prefix before deciding the PIN is wrong.
  const variants = new Set<string>([
    trimmedHash,
    trimmedHash.replace(/^\$2y\$/, "$2a$"),
    trimmedHash.replace(/^\$2b\$/, "$2a$"),
  ]);

  for (const candidateHash of variants) {
    try {
      if (bcrypt.compareSync(pin, candidateHash)) return true;
    } catch {
      // Ignore malformed legacy rows and keep checking other candidates.
    }
  }
  return false;
};

const pushCandidate = (
  candidates: { user_id: string; pin_hash: string }[],
  seen: Set<string>,
  row: { user_id?: unknown; pin_hash?: unknown } | null | undefined,
) => {
  const userId = typeof row?.user_id === "string" ? row.user_id : "";
  const pinHash = typeof row?.pin_hash === "string" ? row.pin_hash : "";
  if (!userId || !pinHash) return;
  const key = `${userId}:${pinHash}`;
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push({ user_id: userId, pin_hash: pinHash });
};

const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return reply({ error: "Unauthorized" }, 401);
    }

    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await anon.auth.getUser();
    if (userErr || !userData?.user) {
      return reply({ error: "Unauthorized" }, 401);
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
      return reply({ error: "Phone or email and 4-6 digit PIN required" }, 400);
    }
    if (!tenant_id || typeof tenant_id !== "string") {
      return reply({ error: "tenant_id required" }, 400);
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
      return reply({ error: "Forbidden" }, 403);
    }

    // Resolve the authorizer via staff_pins (phone or email). We do NOT scope
    // the PIN lookup by tenant_id — some legacy rows may have a null or
    // different tenant_id yet still be the user's active PIN. We enforce
    // tenant membership + required role on the resolved user_id below.
    const isEmail = rawId.includes("@");
    const candidates: { user_id: string; pin_hash: string }[] = [];
    const seenCandidates = new Set<string>();
    let lookupDiag = "";

    if (isEmail) {
      const target = rawId.toLowerCase();
      const authAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { db: { schema: "auth" as any } },
      );
      const { data: userRow } = await authAdmin
        .from("users" as any)
        .select("id, email")
        .ilike("email", target)
        .maybeSingle();
      const foundUserId = (userRow as any)?.id ?? null;
      if (!foundUserId) {
        lookupDiag = "no_auth_user";
      } else {
        const { data } = await admin
          .from("staff_pins")
          .select("user_id, pin_hash")
          .eq("user_id", foundUserId);
        for (const r of data ?? []) pushCandidate(candidates, seenCandidates, r as any);
        if (!candidates.length) lookupDiag = "user_has_no_pin";
      }
    } else {
      const variants = new Set(phoneVariants(rawId));
      const { data: pins } = await admin
        .from("staff_pins")
        .select("user_id, pin_hash, phone");
      for (const row of pins ?? []) {
        if (phoneVariants(String((row as any).phone ?? "")).some((k) => variants.has(k))) {
          pushCandidate(candidates, seenCandidates, row as any);
        }
      }
      if (!candidates.length) lookupDiag = "no_phone_match";
    }

    if (!candidates.length) {
      const msg = lookupDiag === "no_auth_user"
        ? "No account found with that email."
        : "No PIN found for that phone or email. Ask an admin to set one in Staff settings.";
      return reply({ ok: false, error: msg, diag: lookupDiag });
    }

    const rec = candidates.find((c) => safeComparePin(pinStr, c.pin_hash)) ?? null;
    if (!rec) {
      return reply({ ok: false, error: "Invalid PIN" });
    }

    // Confirm the authorizer belongs to the tenant AND holds a required role.
    const { data: authorizerMember } = await admin
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenant_id)
      .eq("user_id", rec.user_id)
      .maybeSingle();
    if (!authorizerMember) {
      return reply({ ok: false, error: "Authorizer is not a member of this workspace." });
    }

    const { data: roleRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", rec.user_id);
    const roles = (roleRows ?? []).map((r: any) => String(r.role));
    const matchedRole = roles.find((r) => requiredRoles.includes(r));
    if (!matchedRole) {
      return reply({ ok: false, error: "This user is not authorized to approve discounts." });
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

    return reply(
      {
        ok: true,
        user: {
          id: rec.user_id,
          name: (profile as any)?.name || email || "Manager",
          role: matchedRole,
        },
      },
    );
  } catch (err) {
    return reply({ error: (err as Error).message }, 500);
  }
});
