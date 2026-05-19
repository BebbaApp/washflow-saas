// Edge function: verify a check-in selfie against an enrolled staff face using
// Google AI Studio's Gemini API (gemini-2.5-pro vision) via its OpenAI-compatible
// endpoint. Returns a match score 0-100 and an isMatch decision (threshold 70).
//
// Modes:
// 1. Self check-in/out: caller verifies against their OWN enrollment, then
//    inserts an attendance record themselves (UI does the insert).
// 2. Assisted check-in (admin/supervisor/manager): caller passes
//    `targetUserId` + `kind`; we verify the live selfie against THAT user's
//    enrollment, upload the selfie via service role, and insert the
//    attendance record server-side using service role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const ASSIST_ROLES = new Set(["admin", "supervisor", "manager"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } }
    );
    const { data: userRes } = await supabase.auth.getUser();
    const caller = userRes?.user;
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { selfieDataUrl, targetUserId, kind } = body as {
      selfieDataUrl?: string; targetUserId?: string; kind?: "check_in" | "check_out";
    };
    if (!selfieDataUrl || typeof selfieDataUrl !== "string") {
      return json({ error: "selfieDataUrl required" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve who is being verified
    const isAssisted = !!targetUserId && targetUserId !== caller.id;
    if (isAssisted) {
      // Caller must hold an assistive role
      const { data: roles } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", caller.id);
      const callerRoles = (roles || []).map((r: any) => r.role);
      if (!callerRoles.some((r: string) => ASSIST_ROLES.has(r))) {
        return json({ error: "forbidden_assisted_check_in" }, 403);
      }
      if (kind !== "check_in" && kind !== "check_out") {
        return json({ error: "kind required for assisted check-in" }, 400);
      }
    }

    const subjectUserId = isAssisted ? targetUserId! : caller.id;

    // Look up active enrollment for the subject
    const { data: enrol } = await admin
      .from("staff_face_enrollments")
      .select("image_url")
      .eq("user_id", subjectUserId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!enrol?.image_url) {
      return json({ error: "no_enrollment" }, 404);
    }

    // Signed URL for the enrolled image
    const path = enrol.image_url.replace(/^.*attendance-selfies\//, "");
    const { data: signed } = await admin.storage
      .from("attendance-selfies")
      .createSignedUrl(path, 60);
    const enrolledUrl = signed?.signedUrl || enrol.image_url;

    const enrolledResp = await fetch(enrolledUrl);
    const enrolledBuf = new Uint8Array(await enrolledResp.arrayBuffer());
    const enrolledB64 = btoa(String.fromCharCode(...enrolledBuf));
    const enrolledMime = enrolledResp.headers.get("content-type") || "image/jpeg";
    const enrolledDataUrl = `data:${enrolledMime};base64,${enrolledB64}`;

    // ============================================================
    // Gemini face comparison via Google's native Generative Language API
    // (uses GEMINI_API_KEY directly — no Lovable AI Gateway dependency)
    // ============================================================
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ error: "AI not configured" }, 500);

    const stripDataUrl = (s: string) => {
      const m = s.match(/^data:([^;]+);base64,(.*)$/);
      return m ? { mimeType: m[1], data: m[2] } : { mimeType: "image/jpeg", data: s };
    };
    const enrolledInline = stripDataUrl(enrolledDataUrl);
    const selfieInline = stripDataUrl(selfieDataUrl);

    const model = "gemini-flash-latest";
    const aiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "You are a face-matching verifier. Given two photos, decide if they show the same person. Reply ONLY with JSON: {\"score\": <0-100>, \"sameFace\": <true|false>, \"reason\": \"...\"}. score is your confidence the faces match. Be strict — different people = score under 40.",
            }],
          },
          contents: [{
            role: "user",
            parts: [
              { text: "Image A (enrolled reference):" },
              { inlineData: enrolledInline },
              { text: "Image B (live selfie):" },
              { inlineData: selfieInline },
              { text: "Is Image B the same person as Image A?" },
            ],
          }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      }
    );

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      return json({ error: "ai_error", detail: txt }, 502);
    }
    const aiJson = await aiResp.json();
    const content: string =
      aiJson?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
    const m = content.match(/\{[\s\S]*\}/);
    let parsed: { score?: number; sameFace?: boolean; reason?: string } = {};
    if (m) { try { parsed = JSON.parse(m[0]); } catch { /* ignore */ } }
    const score = Math.max(0, Math.min(100, Number(parsed.score ?? 0)));
    const isMatch = !!parsed.sameFace && score >= 70;

    // For assisted flow we ALSO upload + insert server-side so the manager
    // can perform the entire action in one round-trip and so RLS doesn't
    // block them from inserting on someone else's behalf. We also log every
    // assisted attempt (success or failure) into attendance_audit_log so
    // there's a tamper-evident trail.
    if (isAssisted) {
      let recordId: string | null = null;
      let uploadedPath: string | null = null;

      if (isMatch) {
        const blob = await (await fetch(selfieDataUrl)).blob();
        const buf = new Uint8Array(await blob.arrayBuffer());
        const objectPath = `${subjectUserId}/${kind}-${Date.now()}.jpg`;
        const { error: upErr } = await admin.storage
          .from("attendance-selfies")
          .upload(objectPath, buf, { contentType: "image/jpeg", upsert: false });
        if (upErr) return json({ error: "upload_failed", detail: upErr.message }, 500);
        uploadedPath = objectPath;

        const { data: rec, error: insErr } = await admin
          .from("attendance_records")
          .insert({
            user_id: subjectUserId,
            kind,
            selfie_url: objectPath,
            match_score: score,
            status: "verified",
            notes: `Assisted by ${caller.email || caller.id}`,
          })
          .select()
          .single();
        if (insErr) return json({ error: insErr.message, score, isMatch }, 400);
        recordId = rec.id;

        await admin.from("attendance_audit_log").insert({
          attendance_id: recordId,
          target_user_id: subjectUserId,
          acted_by: caller.id,
          action: `assisted_${kind}_verified`,
          reason: `Assisted ${kind} by ${caller.email || caller.id} (gemini score ${score})`,
          original_score: score,
          original_status: "verified",
        });

        return json({ score, isMatch, reason: parsed.reason || "", record: rec, assisted: true });
      } else {
        // Failed assisted attempt — log it with no attendance record
        await admin.from("attendance_audit_log").insert({
          attendance_id: null,
          target_user_id: subjectUserId,
          acted_by: caller.id,
          action: `assisted_${kind || "attempt"}_failed`,
          reason: `Face did not match (gemini score ${score}). ${parsed.reason || ""} — by ${caller.email || caller.id}`,
          original_score: score,
          original_status: "rejected",
        });
        return json({ score, isMatch, reason: parsed.reason || "", assisted: true, logged: true });
      }
    }

    return json({ score, isMatch, reason: parsed.reason || "" });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
