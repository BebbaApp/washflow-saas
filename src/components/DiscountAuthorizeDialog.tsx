import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { toast } from "sonner";

export interface AuthorizerIdentity {
  id: string;
  name: string;
  role: string;
}

interface DiscountAuthorizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthorized: (authorizer: AuthorizerIdentity) => void;
  title?: string;
  description?: string;
}

/**
 * Inline manager/admin PIN gate. Verifies a PIN against
 * `verify-authorizer-pin` (service-role, does NOT mint a new session) so the
 * cashier stays signed in. Returns the authorizer identity to the caller.
 */
export const DiscountAuthorizeDialog = ({
  open,
  onOpenChange,
  onAuthorized,
  title = "Manager approval required",
  description = "Ask a manager or admin to enter their PIN to authorize this discount.",
}: DiscountAuthorizeDialogProps) => {
  const { tenant } = useTenant();
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setIdentifier("");
    setPin("");
    setError(null);
    setSubmitting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant?.id) {
      setError("No workspace selected.");
      return;
    }
    if (!identifier.trim()) {
      setError("Enter the manager's phone or email.");
      return;
    }
    if (!/^\d{4,6}$/.test(pin)) {
      setError("PIN must be 4–6 digits.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke(
        "verify-authorizer-pin",
        {
          body: {
            identifier: identifier.trim(),
            pin,
            tenant_id: tenant.id,
            required_roles: ["admin", "manager"],
          },
        },
      );
      const payload = data as any;
      if (fnErr || payload?.error) {
        let friendly = payload?.error ?? null;
        if (!friendly) {
          try {
            const res = (fnErr as any)?.context;
            if (res && typeof res.json === "function") {
              const body = await res.clone().json();
              friendly = body?.error ?? null;
            }
          } catch { /* ignore */ }
        }
        throw new Error(friendly || fnErr?.message || "Authorization failed");
      }
      if (!payload?.ok || !payload?.user) {
        throw new Error(payload?.error || "Authorization failed");
      }
      toast.success(`Authorized by ${payload.user.name}`);
      onAuthorized({
        id: payload.user.id,
        name: payload.user.name,
        role: payload.user.role,
      });
      reset();
      onOpenChange(false);
    } catch (err: any) {
      const msg =
        err?.context?.error ||
        err?.message ||
        "Could not verify PIN. Please try again.";
      setError(String(msg));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <ShieldCheck className="w-4 h-4 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="authorizer-id" className="text-sm text-secondary-foreground">
              Manager phone or email
            </Label>
            <Input
              id="authorizer-id"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="082 123 4567 or manager@email.com"
              autoComplete="off"
              autoFocus
              className="bg-secondary border-border text-foreground"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="authorizer-pin" className="text-sm text-secondary-foreground">
              PIN
            </Label>
            <Input
              id="authorizer-pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••"
              autoComplete="one-time-code"
              className="bg-secondary border-border text-foreground tracking-widest text-center font-mono"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Verifying…
                </>
              ) : (
                "Authorize"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
