import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Droplets, KeyRound, Loader2, AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

const VALIDATION_TIMEOUT_MS = 10000;

const ResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  const [validating, setValidating] = useState(true);
  const [validationError, setValidationError] = useState("");
  const [attempt, setAttempt] = useState(0);

  const validate = useCallback(async () => {
    setValidating(true);
    setValidationError("");

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const errorDesc =
      url.searchParams.get("error_description") ||
      url.hash.match(/error_description=([^&]+)/)?.[1];

    if (errorDesc) {
      setValidationError(decodeURIComponent(errorDesc).replace(/\+/g, " "));
      setValidating(false);
      return;
    }

    try {
      if (code) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exErr) {
          setValidationError(exErr.message);
          setValidating(false);
          return;
        }
        url.searchParams.delete("code");
        window.history.replaceState({}, "", url.pathname);
        setReady(true);
        setValidating(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setReady(true);
        setValidating(false);
        return;
      }

      // Wait briefly for PASSWORD_RECOVERY event from hash-based links
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, VALIDATION_TIMEOUT_MS);
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
          if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
            clearTimeout(timer);
            subscription.unsubscribe();
            setReady(true);
            resolve();
          }
        });
      });

      setValidating(false);
    } catch (err: any) {
      setValidationError(err?.message || "Could not validate reset link");
      setValidating(false);
    }
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    validate();
    return () => subscription.unsubscribe();
  }, [validate, attempt]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setSubmitting(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) {
      setError(updateErr.message);
    } else {
      setSuccess(true);
      await supabase.auth.signOut();
      setTimeout(() => navigate("/"), 2000);
    }
    setSubmitting(false);
  };

  const showInvalid = !validating && !ready;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <Droplets className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Reset Password</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {validating ? "Verifying your link" : ready ? "Enter your new password" : "Link issue"}
          </p>
        </div>

        {success ? (
          <div className="glass-card p-6 text-center space-y-2">
            <p className="text-sm text-foreground font-semibold">Password updated</p>
            <p className="text-xs text-muted-foreground">Redirecting to sign in...</p>
          </div>
        ) : validating ? (
          <div className="glass-card p-6 flex flex-col items-center text-center space-y-4">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <div className="space-y-1">
              <p className="text-sm text-foreground font-medium">Validating reset link...</p>
              <p className="text-xs text-muted-foreground">This usually takes a couple of seconds.</p>
            </div>
          </div>
        ) : showInvalid ? (
          <div className="glass-card p-6 space-y-4">
            <div className="flex flex-col items-center text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-destructive" />
              </div>
              <div className="space-y-1">
                <p className="text-sm text-foreground font-semibold">Reset link invalid or expired</p>
                <p className="text-xs text-muted-foreground">
                  {validationError || "We couldn't validate your reset link. It may have expired or already been used."}
                </p>
              </div>
            </div>
            <button
              onClick={() => setAttempt((n) => n + 1)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              <RefreshCw className="w-4 h-4" />
              Try again
            </button>
            <Link
              to="/"
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              <ArrowLeft className="w-4 h-4" />
              Request a new link
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="glass-card p-6 space-y-4">
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">New Password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" autoComplete="new-password" />
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Confirm Password</Label>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" autoComplete="new-password" />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button type="submit" disabled={submitting} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50">
              <KeyRound className="w-4 h-4" />
              {submitting ? "Updating..." : "Update Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
