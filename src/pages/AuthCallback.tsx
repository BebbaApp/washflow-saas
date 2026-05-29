import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status = "working" | "success" | "error";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("working");
  const [message, setMessage] = useState("Confirming your email…");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const url = new URL(window.location.href);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

        const errorDesc = url.searchParams.get("error_description") || hash.get("error_description");
        if (errorDesc) throw new Error(errorDesc);

        // PKCE flow: ?code=...
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          // Implicit flow: #access_token=...&refresh_token=...
          const access_token = hash.get("access_token");
          const refresh_token = hash.get("refresh_token");
          if (access_token && refresh_token) {
            const { error } = await supabase.auth.setSession({ access_token, refresh_token });
            if (error) throw error;
          }
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Verification link is invalid or has expired.");

        if (cancelled) return;
        setStatus("success");
        setMessage("Email verified. Signing you in…");
        setTimeout(() => navigate("/", { replace: true }), 1200);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setMessage((err as Error).message || "Verification failed.");
      }
    })();

    return () => { cancelled = true; };
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-4 rounded-2xl border border-border bg-card p-8 shadow-sm">
        {status === "working" && <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />}
        {status === "success" && <CheckCircle2 className="h-10 w-10 mx-auto text-primary" />}
        {status === "error" && <XCircle className="h-10 w-10 mx-auto text-destructive" />}
        <h1 className="text-xl font-semibold text-foreground">
          {status === "success" ? "You're verified" : status === "error" ? "Verification failed" : "Just a moment"}
        </h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        {status === "error" && (
          <Button onClick={() => navigate("/", { replace: true })} className="mt-2">
            Back to login
          </Button>
        )}
      </div>
    </div>
  );
}
