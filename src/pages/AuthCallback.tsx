import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle2, XCircle, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

type Status = "working" | "success" | "error";

const POLL_INTERVAL_MS = 1200;
const DEADLINE_MS = 15000;

export default function AuthCallback() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [status, setStatus] = useState<Status>("working");
  const [message, setMessage] = useState("Confirming your email…");
  const [pollCount, setPollCount] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        const url = new URL(window.location.href);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        let verifiedSession = null;

        const errorDesc = url.searchParams.get("error_description") || hash.get("error_description");
        if (errorDesc) throw new Error(errorDesc);

        // PKCE flow: ?code=...
        const code = url.searchParams.get("code");
        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            const msg = error.message.toLowerCase();
            if (msg.includes("code verifier") || msg.includes("flow state") || msg.includes("invalid flow")) {
              if (cancelled) return;
              setStatus("success");
              setMessage("Email confirmed. Please sign in to continue.");
              setProgressPct(100);
              setTimeout(() => navigate("/", { replace: true }), 1800);
              return;
            }
            throw error;
          }
          verifiedSession = data.session;
        } else {
          // Email-template flow: ?token_hash=...&type=signup
          const token_hash = url.searchParams.get("token_hash") || hash.get("token_hash");
          const type = url.searchParams.get("type") || hash.get("type") || "signup";
          if (token_hash) {
            const { data, error } = await supabase.auth.verifyOtp({
              token_hash,
              type: type as "signup" | "invite" | "magiclink" | "recovery" | "email_change",
            });
            if (error) throw error;
            verifiedSession = data.session;
          }

          // Implicit flow: #access_token=...&refresh_token=...
          const access_token = hash.get("access_token");
          const refresh_token = hash.get("refresh_token");
          if (access_token && refresh_token) {
            const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
            if (error) throw error;
            verifiedSession = data.session;
          }
        }

        const { data: { session } } = verifiedSession ? { data: { session: verifiedSession } } : await supabase.auth.getSession();
        if (!session) {
          if (cancelled) return;
          setStatus("success");
          setMessage("Email confirmed. Please sign in to continue.");
          setProgressPct(100);
          setTimeout(() => navigate("/", { replace: true }), 1800);
          return;
        }

        if (cancelled) return;
        setStatus("success");
        setMessage("Email verified. Checking your account…");
        startRef.current = Date.now();

        // Poll for confirmed status + role assignment, then refresh app state in place.
        let pollsDone = 0;
        let confirmed = false;
        pollTimer = setInterval(() => {
          const elapsed = Date.now() - startRef.current;
          const pct = Math.min(100, Math.round((elapsed / DEADLINE_MS) * 100));
          setProgressPct(pct);
        }, 100);

        while (!cancelled && Date.now() - startRef.current < DEADLINE_MS) {
          try {
            await supabase.auth.refreshSession();
            const { data: { user: u } } = await supabase.auth.getUser();
            if (u?.email_confirmed_at) {
              confirmed = true;
              break;
            }
          } catch { /* keep polling */ }
          pollsDone += 1;
          if (!cancelled) {
            setPollCount(pollsDone);
            setMessage(`Checking your account… (attempt ${pollsDone})`);
          }
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }

        if (pollTimer) clearInterval(pollTimer);
        if (cancelled) return;

        setProgressPct(100);
        await refresh();
        setMessage(confirmed ? "You're verified. Redirecting…" : "Almost done. Redirecting…");
        setTimeout(() => navigate("/", { replace: true }), 800);
      } catch (err) {
        if (pollTimer) clearInterval(pollTimer);
        if (cancelled) return;
        setStatus("error");
        setProgressPct(0);
        setMessage((err as Error).message || "Verification failed.");
      }
    })();

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [navigate, refresh]);

  const isPolling = status === "working" || (status === "success" && progressPct > 0 && progressPct < 100);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-5 rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="mx-auto flex items-center justify-center">
          {status === "working" && (
            <div className="relative">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          )}
          {status === "success" && <CheckCircle2 className="h-10 w-10 text-primary" />}
          {status === "error" && <XCircle className="h-10 w-10 text-destructive" />}
        </div>

        <div>
          <h1 className="text-xl font-semibold text-foreground">
            {status === "success" ? "You're verified" : status === "error" ? "Verification failed" : "Just a moment"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{message}</p>
        </div>

        {isPolling && (
          <div className="space-y-2">
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Shield className="h-3 w-3" />
                Securing session
              </span>
              <span>{progressPct}%</span>
            </div>
          </div>
        )}

        {status === "error" && (
          <Button onClick={() => navigate("/", { replace: true })} className="mt-2">
            Back to login
          </Button>
        )}
      </div>
    </div>
  );
}
