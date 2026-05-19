import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, pin } = await req.json();
    if (!phone || !pin || !/^\d{4,6}$/.test(String(pin))) {
      return new Response(JSON.stringify({ error: "Phone and 4-6 digit PIN required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const normalizedPhone = String(phone).replace(/\s+/g, "");
    const { data: rec } = await admin
      .from("staff_pins")
      .select("user_id, pin_hash")
      .eq("phone", normalizedPhone)
      .maybeSingle();

    if (!rec) {
      return new Response(JSON.stringify({ error: "Invalid phone or PIN" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ok = await bcrypt.compare(String(pin), rec.pin_hash);
    if (!ok) {
      return new Response(JSON.stringify({ error: "Invalid phone or PIN" }), {
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
