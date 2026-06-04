import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle2, AlertTriangle, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { Button } from "@/components/ui/button";

type Phase = "loading" | "needs-auth" | "ready" | "accepting" | "done" | "error";

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { isAuthenticated, user } = useAuth();
  const { refresh, switchTenant } = useTenant();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<string>("");
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setPhase("error"); setMessage("Missing invite token."); return; }
    if (!isAuthenticated) { setPhase("needs-auth"); return; }
    setPhase("ready");
  }, [token, isAuthenticated]);

  const accept = async () => {
    setPhase("accepting");
    try {
      const { data, error } = await supabase.functions.invoke("accept-invite", { body: { token } });
      if (error) throw new Error(error.message);
      const tid = (data as any)?.tenant_id as string | undefined;
      setTenantId(tid ?? null);
      await refresh();
      if (tid) {
        try { await switchTenant(tid); } catch { /* non-fatal */ }
      }
      setPhase("done");
    } catch (e: any) {
      setPhase("error");
      setMessage(e?.message ?? "Failed to accept invite.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="glass-card p-8 max-w-md w-full space-y-5 text-center">
        <div className="flex justify-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Building2 className="w-6 h-6 text-primary" />
          </div>
        </div>
        <h1 className="text-xl font-bold text-foreground">Workspace invitation</h1>

        {phase === "loading" && <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />}

        {phase === "needs-auth" && (
          <>
            <p className="text-sm text-muted-foreground">
              Sign in or create an account using the email this invite was sent to, then return to this link.
            </p>
            <Button className="w-full" onClick={() => navigate(`/?next=${encodeURIComponent(window.location.pathname + window.location.search)}`)}>
              Go to sign in
            </Button>
          </>
        )}

        {phase === "ready" && (
          <>
            <p className="text-sm text-muted-foreground">
              You're signed in as <span className="text-foreground font-medium">{user?.email}</span>. Accept the invite to join the workspace.
            </p>
            <Button className="w-full" onClick={accept}>Accept invitation</Button>
          </>
        )}

        {phase === "accepting" && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Accepting…
          </div>
        )}

        {phase === "done" && (
          <>
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
            <p className="text-sm text-foreground">You've joined the workspace.</p>
            <Button className="w-full" onClick={() => navigate("/")}>Open workspace</Button>
          </>
        )}

        {phase === "error" && (
          <>
            <AlertTriangle className="w-8 h-8 text-destructive mx-auto" />
            <p className="text-sm text-destructive">{message}</p>
            <Button variant="outline" className="w-full" onClick={() => navigate("/")}>Back home</Button>
          </>
        )}
      </div>
    </div>
  );
}
