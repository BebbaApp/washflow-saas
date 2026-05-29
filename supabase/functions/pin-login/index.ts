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
    const localWithoutZero = digits.slice(1);
    variants.add(localWithoutZero);
    variants.add(`27${localWithoutZero}`);
    variants.add(`+27${localWithoutZero}`);
  } else if (digits.startsWith("27") && digits.length > 2) {
    const localWithoutCode = digits.slice(2);
    variants.add(localWithoutCode);
    variants.add(`0${localWithoutCode}`);
  }

  return Array.from(variants);
};

const phoneMatchKeys = (raw: string | null | undefined): string[] => phoneVariants(String(raw ?? ""));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { phone, email, identifier, pin } = body ?? {};

    // Accept either an explicit phone/email field, or a generic "identifier" the
    // user typed. We auto-detect email vs phone so the same form field works for
    // both — admins can share PIN-login with a phone OR an email.
    const rawId = String(identifier ?? email ?? phone ?? "").trim();
    if (!rawId || !pin || !/^\d{4,6}$/.test(String(pin))) {
      return new Response(JSON.stringify({ error: "Phone or email and 4-6 digit PIN required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isEmail = rawId.includes("@");
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve to a staff_pins row by either phone OR auth.users email.
    let rec: { user_id: string; pin_hash: string } | null = null;

    if (isEmail) {
      // Find the auth user by email, then look up their PIN row.
      // listUsers paginates; we search exhaustively across the first few pages.
      const target = rawId.toLowerCase();
      let foundUserId: string | null = null;
      for (let page = 1; page <= 10 && !foundUserId; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) break;
        const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
        if (hit) foundUserId = hit.id;
        if (data.users.length < 200) break;
      }
      if (foundUserId) {
        const { data } = await admin
          .from("staff_pins")
          .select("user_id, pin_hash")
          .eq("user_id", foundUserId)
          .maybeSingle();
        rec = data ?? null;
      }
    } else {
      const variants = phoneVariants(rawId);
      console.log("[pin-login] phone lookup", { rawId, variants });
      // Always fetch all and match in code — RLS/encoding issues with .in() can silently miss.
      const { data: pins, error: pinsErr } = await admin
        .from("staff_pins")
        .select("user_id, pin_hash, phone");
      if (pinsErr) console.log("[pin-login] staff_pins query error", pinsErr);
      console.log("[pin-login] staff_pins rows", pins?.length, pins?.map((p) => p.phone));
      const variantSet = new Set(variants);
      const match = (pins ?? []).find((row) => phoneMatchKeys(row.phone).some((key) => variantSet.has(key)));
      rec = match ? { user_id: match.user_id, pin_hash: match.pin_hash } : null;
    }

    if (!rec) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ok = bcrypt.compareSync(String(pin), rec.pin_hash);
    if (!ok) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user email to generate magic link
    const { data: userRes, error: getUserErr } = await admin.auth.admin.getUserById(rec.user_id);
    if (getUserErr || !userRes.user?.email) {
      return new Response(JSON.stringify({ error: "User account not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate a magic link to extract a session
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: userRes.user.email,
    });

    if (linkErr || !linkData.properties) {
      return new Response(JSON.stringify({ error: linkErr?.message || "Could not create session" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        email: userRes.user.email,
        token_hash: linkData.properties.hashed_token,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
