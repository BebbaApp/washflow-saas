import { useEffect, useState } from "react";
import { CreditCard, Loader2, Check, AlertTriangle, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useCurrency } from "@/hooks/useCurrency";

import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";


interface Plan {
  id: string;
  code: string;
  name: string;
  price_monthly_cents: number;
  max_users: number | null;
  features: Record<string, any>;
  stripe_price_id: string | null;
}

const STATUS_COPY: Record<string, { label: string; className: string }> = {
  trialing: { label: "Free trial", className: "bg-primary/10 text-primary" },
  active: { label: "Active", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  past_due: { label: "Past due", className: "bg-destructive/10 text-destructive" },
  suspended: { label: "Suspended", className: "bg-destructive/10 text-destructive" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
};

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(0)}/mo`;
}

export function BillingSection() {
  const { tenant, daysUntilTrialEnd, refresh } = useTenant();
  
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  

  const loadPlans = async () => {
    const { data } = await supabase.from("plans" as any).select("*").order("price_monthly_cents");
    setPlans(((data as any) ?? []) as Plan[]);
    setLoading(false);
  };

  useEffect(() => {
    loadPlans();
  }, []);




  const currentPlan = plans.find((p) => p.id === tenant?.plan_id);
  const status = tenant?.status ?? "trialing";
  const statusBadge = STATUS_COPY[status] ?? STATUS_COPY.trialing;
  const missingPriceIds = plans.filter((p) => !p.stripe_price_id);

  const openPortal = async () => {
    if (!tenant) return;
    setActionLoading("portal");
    try {
      const { data, error } = await supabase.functions.invoke("create-billing-portal", {
        body: { tenant_id: tenant.id, return_url: window.location.href },
      });
      if (error || !data?.url) {
        toast({
          title: "Billing not available yet",
          description: "Stripe isn't configured for this workspace. Ask your administrator to add billing.",
          variant: "destructive",
        });
        return;
      }
      window.location.href = data.url as string;
    } catch (e: any) {
      toast({ title: "Portal error", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const upgradeTo = async (plan: Plan) => {
    if (!tenant || !plan.stripe_price_id) return;
    setActionLoading(plan.id);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: {
          tenant_id: tenant.id,
          plan_id: plan.id,
          success_url: window.location.href,
          cancel_url: window.location.href,
        },
      });
      if (error || !data?.url) {
        toast({
          title: "Checkout unavailable",
          description: "Stripe checkout isn't configured yet. Try again once billing is set up.",
          variant: "destructive",
        });
        return;
      }
      window.location.href = data.url as string;
    } catch (e: any) {
      toast({ title: "Checkout error", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  if (!tenant) {
    return (
      <div className="glass-card p-8 text-center text-muted-foreground text-sm">
        No workspace found. Reload the page.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Missing Stripe price ID warning */}
      {missingPriceIds.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-4 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium text-foreground">
              {missingPriceIds.length} plan{missingPriceIds.length === 1 ? "" : "s"} not connected to Stripe
            </p>
            <p className="text-xs text-muted-foreground">
              Upgrade is disabled for:{" "}
              <span className="text-foreground font-medium">
                {missingPriceIds.map((p) => p.code).join(", ")}
              </span>
              . Ask a platform admin to add Stripe price IDs.
            </p>
          </div>
        </div>
      )}

      {/* Current plan card */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Current plan</span>
            </div>
            <h3 className="text-2xl font-bold text-foreground">
              {currentPlan?.name ?? (status === "trialing" ? "Free trial" : "No plan")}
            </h3>
            <p className="text-sm text-muted-foreground">
              Workspace: <span className="text-foreground font-medium">{tenant.name}</span>
            </p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusBadge.className}`}>
            {statusBadge.label}
          </span>
        </div>

        {status === "trialing" && daysUntilTrialEnd !== null && (
          <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 flex items-start gap-3">
            <Sparkles className="w-4 h-4 text-primary mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                {Math.max(daysUntilTrialEnd, 0)} day{daysUntilTrialEnd === 1 ? "" : "s"} left in your trial
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick a plan below to keep access after {new Date(tenant.trial_ends_at).toLocaleDateString()}.
              </p>
            </div>
          </div>
        )}

        {status === "past_due" && (
          <div className="rounded-lg bg-destructive/5 border border-destructive/30 p-4 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">Payment failed</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Update your card before {tenant.grace_period_ends_at ? new Date(tenant.grace_period_ends_at).toLocaleDateString() : "your grace period ends"} to avoid losing access.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={openPortal} disabled={actionLoading === "portal"}>
            {actionLoading === "portal" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Manage billing
          </Button>
          <Button variant="outline" onClick={refresh}>Refresh</Button>
        </div>
      </div>

      {/* Plans grid */}
      <div>
        <h4 className="text-sm font-semibold text-foreground mb-3">Available plans</h4>
        {loading ? (
          <div className="glass-card p-8 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {plans.map((plan) => {
              const isCurrent = plan.id === tenant.plan_id;
              const features = Object.entries(plan.features ?? {}).filter(([, v]) => v);
              const noPriceId = !plan.stripe_price_id;
              return (
                <div
                  key={plan.id}
                  className={`glass-card p-5 flex flex-col gap-3 border ${
                    isCurrent ? "border-primary/50 ring-1 ring-primary/30" : "border-border"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h5 className="text-lg font-bold text-foreground">{plan.name}</h5>
                      <p className="text-2xl font-bold text-primary">{formatPrice(plan.price_monthly_cents)}</p>
                    </div>
                    {isCurrent && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                        Current
                      </span>
                    )}
                  </div>
                  <ul className="space-y-1.5 text-xs text-muted-foreground flex-1">
                    {plan.max_users && (
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-primary" /> Up to {plan.max_users} users
                      </li>
                    )}
                    {features.map(([k]) => (
                      <li key={k} className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-primary" /> <span className="capitalize">{k.replace(/_/g, " ")}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    onClick={() => upgradeTo(plan)}
                    disabled={isCurrent || noPriceId || actionLoading === plan.id}
                    variant={isCurrent ? "outline" : "default"}
                    className="w-full"
                    title={noPriceId ? "Stripe price ID not set for this plan" : undefined}
                  >
                    {actionLoading === plan.id && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {isCurrent ? "Current plan" : noPriceId ? "Not configured" : "Upgrade"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}


