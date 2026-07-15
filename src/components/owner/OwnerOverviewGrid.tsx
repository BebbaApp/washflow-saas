import { useNavigate } from "react-router-dom";
import { Building2, Users, Car, Wallet, AlertTriangle, ArrowRight, TrendingUp, Download } from "lucide-react";
import { useOwnerOverview, type OwnerTenantSummary } from "@/hooks/useOwnerOverview";
import { useTenant } from "@/hooks/useTenant";
import { useCurrency } from "@/hooks/useCurrency";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export function OwnerOverviewGrid() {
  const { data, isLoading } = useOwnerOverview();
  const { switchTenant } = useTenant();
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const navigate = useNavigate();

  const openWorkspace = async (t: OwnerTenantSummary) => {
    try {
      await switchTenant(t.id);
      navigate("/?tab=dashboard");
    } catch (e: any) {
      toast({ title: "Could not switch", description: e?.message ?? "", variant: "destructive" });
    }
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading workspaces…</div>;
  const tenants = data?.tenants ?? [];
  if (!tenants.length) return <div className="text-sm text-muted-foreground">No workspaces to show.</div>;

  const totals = tenants.reduce(
    (acc, t) => {
      acc.revenue += t.revenue;
      acc.expenses += t.expenses;
      acc.orders += t.orders_count;
      acc.workers += t.workers_total;
      return acc;
    },
    { revenue: 0, expenses: 0, orders: 0, workers: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryStat icon={Wallet} label="MTD Revenue" value={formatPrice(totals.revenue)} color="text-success" />
        <SummaryStat icon={TrendingUp} label="MTD Expenses" value={formatPrice(totals.expenses)} color="text-warning" />
        <SummaryStat icon={Car} label="MTD Orders" value={String(totals.orders)} color="text-primary" />
        <SummaryStat icon={Users} label="Total Workers" value={String(totals.workers)} color="text-info" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tenants.map((t) => (
          <div key={t.id} className="glass-card p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-primary shrink-0" />
                  <h3 className="font-semibold truncate">{t.name}</h3>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">
                  {t.my_role} · {t.status}
                </p>
              </div>
              <StatusBadge status={t.status} />
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Metric label="Today revenue" value={formatPrice(t.today_revenue)} />
              <Metric label="Today cars" value={String(t.today_orders)} />
              <Metric label="MTD revenue" value={formatPrice(t.revenue)} />
              <Metric label="MTD expenses" value={formatPrice(t.expenses)} />
              <Metric label="On shift" value={`${t.workers_on_shift} / ${t.workers_total}`} />
              <Metric
                label="Low stock"
                value={String(t.inventory_low)}
                warn={t.inventory_low > 0}
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1 gap-2" onClick={() => openWorkspace(t)}>
                Open <ArrowRight className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                title="Download workspace data as JSON"
                onClick={async () => {
                  try {
                    const { data, error } = await supabase.functions.invoke("export-tenant", { body: { tenant_id: t.id } });
                    if (error) throw error;
                    const blob = new Blob([typeof data === "string" ? data : JSON.stringify(data, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = `${t.slug ?? t.id}-export.json`;
                    document.body.appendChild(a); a.click(); a.remove();
                    URL.revokeObjectURL(url);
                    toast({ title: "Export ready" });
                  } catch (e: any) {
                    toast({ title: "Export failed", description: e?.message ?? "", variant: "destructive" });
                  }
                }}
              >
                <Download className="w-3.5 h-3.5" />
              </Button>
            </div>
        ))}
      </div>
    </div>
  );
}

function SummaryStat({ icon: Icon, label, value, color }: any) {
  return (
    <div className="glass-card p-4">
      <Icon className={`w-4 h-4 ${color}`} />
      <p className="stat-value text-foreground mt-2">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`font-medium ${warn ? "text-warning flex items-center gap-1" : ""}`}>
        {warn && <AlertTriangle className="w-3 h-3" />} {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-success/10 text-success border-success/30",
    trialing: "bg-info/10 text-info border-info/30",
    past_due: "bg-warning/10 text-warning border-warning/30",
    suspended: "bg-destructive/10 text-destructive border-destructive/30",
    cancelled: "bg-muted text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={`${map[status] ?? ""} text-[10px] capitalize`}>
      {status.replace("_", " ")}
    </Badge>
  );
}
