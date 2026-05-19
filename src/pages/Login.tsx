import { useState } from "react";
import { Droplets, LogIn, UserPlus, Phone as PhoneIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";

interface LoginProps {
  onLogin: (email: string, password: string) => Promise<string | null>;
  onSignup: (email: string, password: string, name: string, phone?: string) => Promise<string | null>;
}

const Login = ({ onLogin, onSignup }: LoginProps) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) { setError("Enter your email first"); return; }
    setSubmitting(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (err) setError(err.message);
    else setResetSent(true);
    setSubmitting(false);
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    if (isSignup) {
      const err = await onSignup(email, password, name, phone);
      if (err) setError(err);
      else setSignupSuccess(true);
    } else {
      const err = await onLogin(email, password);
      if (err) setError(err);
    }
    setSubmitting(false);
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("pin-login", {
        body: { phone: phone.trim(), pin: pin.trim() },
      });
      if (invokeErr || data?.error) {
        setError(data?.error || invokeErr?.message || "Login failed");
      } else if (data?.token_hash) {
        const { error: verifyErr } = await supabase.auth.verifyOtp({
          token_hash: data.token_hash,
          type: "magiclink",
        });
        if (verifyErr) setError(verifyErr.message);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setSubmitting(false);
  };

  if (signupSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Droplets className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Check Your Email</h1>
            <p className="text-sm text-muted-foreground mt-2 text-center">
              We sent a confirmation link to <strong className="text-foreground">{email}</strong>.
            </p>
          </div>
          <button
            onClick={() => { setSignupSuccess(false); setIsSignup(false); }}
            className="w-full py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <Droplets className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">AquaWash</h1>
          <p className="text-sm text-muted-foreground mt-1">Staff Portal</p>
        </div>

        <Tabs defaultValue="email" className="w-full" onValueChange={() => setError("")}>
          <TabsList className="grid grid-cols-2 w-full mb-4">
            <TabsTrigger value="email">Email</TabsTrigger>
            <TabsTrigger value="phone">Phone + PIN</TabsTrigger>
          </TabsList>

          <TabsContent value="email">
            <form onSubmit={handleEmailSubmit} className="glass-card p-6 space-y-4">
              {isSignup && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-sm text-secondary-foreground">Full Name</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Smith" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-phone" className="text-sm text-secondary-foreground">Phone Number</Label>
                    <Input id="signup-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 234 567 8900" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" autoComplete="tel" />
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm text-secondary-foreground">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@aquawash.com" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" autoComplete="email" />
              </div>
              {!forgotMode && (
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm text-secondary-foreground">Password</Label>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" autoComplete={isSignup ? "new-password" : "current-password"} />
                </div>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
              {resetSent && <p className="text-xs text-primary">Reset link sent! Check your inbox.</p>}
              {forgotMode ? (
                <>
                  <button type="button" onClick={handleForgot} disabled={submitting} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50">
                    {submitting ? "Sending..." : "Send Reset Link"}
                  </button>
                  <button type="button" onClick={() => { setForgotMode(false); setError(""); setResetSent(false); }} className="w-full text-xs text-muted-foreground hover:text-foreground text-center transition-colors">
                    Back to Sign In
                  </button>
                </>
              ) : (
                <>
                  <button type="submit" disabled={submitting} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50">
                    {isSignup ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
                    {submitting ? "Please wait..." : isSignup ? "Create Account" : "Sign In"}
                  </button>
                  {!isSignup && (
                    <button type="button" onClick={() => { setForgotMode(true); setError(""); }} className="w-full text-xs text-primary hover:underline text-center transition-colors">
                      Forgot password?
                    </button>
                  )}
                  <button type="button" onClick={() => { setIsSignup(!isSignup); setError(""); }} className="w-full text-xs text-muted-foreground hover:text-foreground text-center transition-colors">
                    {isSignup ? "Already have an account? Sign in" : "Need an account? Sign up"}
                  </button>
                </>
              )}
            </form>
          </TabsContent>

          <TabsContent value="phone">
            <form onSubmit={handlePinSubmit} className="glass-card p-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-sm text-secondary-foreground">Phone Number</Label>
                <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 234 567 8900" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" autoComplete="tel" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pin" className="text-sm text-secondary-foreground">PIN</Label>
                <Input id="pin" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="4-6 digits" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground tracking-widest" />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <button type="submit" disabled={submitting} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50">
                <PhoneIcon className="w-4 h-4" />
                {submitting ? "Please wait..." : "Sign In with PIN"}
              </button>
              <p className="text-xs text-muted-foreground text-center">Ask your administrator to set up phone + PIN access.</p>
            </form>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Login;
