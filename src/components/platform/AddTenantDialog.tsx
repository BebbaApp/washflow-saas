import { useEffect, useState } from "react";
import { Loader2, Copy, Check, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface PlanRow { id: string; name: string; price_monthly_cents: number }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plans: PlanRow[];
  onCreated?: () => void;
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export function AddTenantDialog({ open, onOpenChange, plans, onCreated }: Props) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [planId, setPlanId] = useState<string>("");
  const [trialDays, setTrialDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; slug: string; name: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName(""); setSlug(""); setSlugEdited(false); setPlanId("");
      setTrialDays(30); setCreated(null); setCopied(null);
    }
  }, [open]);

  useEffect(() => {
    if (!slugEdited) setSlug(slugify(name));
  }, [name, slugEdited]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const accessUrl = created ? `${origin}/?tenant=${created.slug}` : "";
  const signupUrl = created ? `${origin}/login?tenant=${created.slug}&mode=signup` : "";

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("platform-admin", {
        body: {
          action: "create_tenant",
          name, slug,
          plan_id: planId || undefined,
          trial_days: trialDays,
        },
      });
      if (error) throw error;
      setCreated((data as any)?.tenant ?? null);
      toast({ title: "Tenant created" });
      onCreated?.();
    } catch (e: any) {
      toast({ title: "Create failed", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{created ? "Tenant ready" : "Add tenant"}</DialogTitle>
          <DialogDescription>
            {created
              ? "Share these links so the workspace owner can sign in or invite their team."
              : "Create a new workspace. A free trial will start immediately."}
          </DialogDescription>
        </DialogHeader>

        {!created ? (
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Car Wash" />
            </div>
            <div className="space-y-1">
              <Label>Slug</Label>
              <Input
                value={slug}
                onChange={(e) => { setSlugEdited(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-")); }}
                placeholder="acme-car-wash"
              />
              <p className="text-[11px] text-muted-foreground">Used in the tenant URL. Lowercase letters, numbers, and dashes.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Plan</Label>
                <Select value={planId} onValueChange={setPlanId}>
                  <SelectTrigger><SelectValue placeholder="None (trial only)" /></SelectTrigger>
                  <SelectContent>
                    {plans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Trial days</Label>
                <Input
                  type="number" min={0} max={365}
                  value={trialDays}
                  onChange={(e) => setTrialDays(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <LinkRow
              label="Tenant access link"
              hint="Direct workspace URL for members already signed up."
              url={accessUrl}
              copied={copied === "access"}
              onCopy={() => copy("access", accessUrl)}
            />
            <LinkRow
              label="User sign-up link"
              hint="Share with new users to register and join this tenant."
              url={signupUrl}
              copied={copied === "signup"}
              onCopy={() => copy("signup", signupUrl)}
            />
          </div>
        )}

        <DialogFooter>
          {!created ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button onClick={submit} disabled={busy || !name || !slug}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create tenant"}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkRow({ label, hint, url, copied, onCopy }: { label: string; hint: string; url: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button variant="outline" size="icon" onClick={onCopy} title="Copy">
          {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
        </Button>
        <Button variant="outline" size="icon" asChild title="Open">
          <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" /></a>
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
