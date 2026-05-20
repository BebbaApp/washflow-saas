import { useEffect, useMemo, useState } from "react";
import { Loader2, Building2, Users, Calendar, MoreHorizontal, Eye, Shield, Pencil } from "lucide-react";
import { EditTenantDialog } from "./EditTenantDialog";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useTenant } from "@/hooks/useTenant";

interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  grace_period_ends_at: string | null;
  created_at: string;
  stripe_customer_id: string | null;
  plan_id: string | null;
  plan_code: string | null;
  plan_name: string | null;
  price_monthly_cents: number | null;
  member_count: number;
  active_sub_count: number;
}

interface PlanRow { id: string; code: string; name: string; price_monthly_cents: number }

const STATUS_OPTIONS = ["trialing", "active", "past_due", "suspended", "cancelled"];

export function TenantsAdmin() {
  const { toast } = useToast();
  const { refresh } = useTenant();
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [extendDays, setExtendDays] = useState<Record<string, number>>({});
  const [editTenant, setEditTenant] = useState<PlatformTenant | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("platform-admin", {
      body: { action: "list_tenants" },
    });
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else setTenants(((data as any)?.tenants ?? []) as PlatformTenant[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    supabase.from("plans" as any).select("id, code, name, price_monthly_cents")
      .order("price_monthly_cents")
      .then(({ data }) => setPlans(((data as any) ?? []) as PlanRow[]));
  }, []);

  const filtered = useMemo(() => {
    return tenants.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        return t.name.toLowerCase().includes(s) || t.slug.toLowerCase().includes(s);
      }
      return true;
    });
  }, [tenants, search, statusFilter]);

  const mrrCents = useMemo(() =>
    tenants.filter((t) => t.status === "active").reduce((sum, t) => sum + (t.price_monthly_cents ?? 0), 0),
    [tenants]);

  const callAction = async (body: Record<string, unknown>, id: string, successMsg: string) => {
    setBusyId(id);
    try {
      const { error } = await supabase.functions.invoke("platform-admin", { body });
      if (error) throw error;
      toast({ title: successMsg });
      await load();
    } catch (e: any) {
      toast({ title: "Action failed", description: e?.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const impersonate = async (t: PlatformTenant) => {
    setBusyId(t.id);
    try {
      const { error } = await supabase.functions.invoke("platform-admin", {
        body: { action: "impersonate_tenant", tenant_id: t.id },
      });
      if (error) throw error;
      await supabase.auth.refreshSession();
      await refresh();
      toast({ title: `Now viewing ${t.name}` });
      window.location.href = "/";
    } catch (e: any) {
      toast({ title: "Impersonation failed", description: e?.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Stat label="Total tenants" value={tenants.length.toString()} icon={<Building2 className="w-4 h-4" />} />
        <Stat label="Active" value={tenants.filter((t) => t.status === "active").length.toString()} />
        <Stat label="Trialing" value={tenants.filter((t) => t.status === "trialing").length.toString()} />
        <Stat label="Est. MRR" value={`$${(mrrCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
      </div>

      <div className="glass-card p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex gap-2 flex-wrap">
            <Input placeholder="Search name or slug…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh"}
          </Button>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_120px] gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/30">
            <div>Workspace</div>
            <div>Status</div>
            <div>Plan</div>
            <div>Members</div>
            <div>Trial / period</div>
            <div className="text-right">Actions</div>
          </div>
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {loading ? "Loading…" : "No tenants match."}
            </div>
          ) : (
            <ul className="divide-y divide-border max-h-[600px] overflow-y-auto">
              {filtered.map((t) => (
                <li key={t.id} className="text-sm grid grid-cols-[2fr_1fr_1fr_1fr_1fr_120px] gap-2 px-3 py-3 items-center">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">{t.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{t.slug}</div>
                  </div>
                  <StatusBadge status={t.status} />
                  <Select
                    value={t.plan_id ?? "_none"}
                    onValueChange={(v) => v !== "_none" && callAction(
                      { action: "change_plan", tenant_id: t.id, plan_id: v }, t.id, "Plan updated")}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {plans.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name} (${(p.price_monthly_cents / 100).toFixed(0)})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Users className="w-3.5 h-3.5" />{t.member_count}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t.status === "trialing" && t.trial_ends_at
                      ? `Trial → ${new Date(t.trial_ends_at).toLocaleDateString()}`
                      : t.current_period_end
                        ? `Renews ${new Date(t.current_period_end).toLocaleDateString()}`
                        : "—"}
                  </div>
                  <div className="flex justify-end">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost" disabled={busyId === t.id}>
                          {busyId === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreHorizontal className="w-4 h-4" />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56 bg-card">
                        <DropdownMenuLabel>Change status</DropdownMenuLabel>
                        {STATUS_OPTIONS.map((s) => (
                          <DropdownMenuItem
                            key={s}
                            disabled={s === t.status}
                            onClick={() => callAction(
                              { action: "set_tenant_status", tenant_id: t.id, status: s }, t.id, `Status → ${s}`)}
                          >
                            {s}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <div className="px-2 py-2 flex gap-2 items-center">
                          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                          <Input
                            type="number" min={1} max={365}
                            placeholder="days"
                            value={extendDays[t.id] ?? 14}
                            onChange={(e) => setExtendDays({ ...extendDays, [t.id]: Number(e.target.value) })}
                            className="h-7 w-16 text-xs"
                          />
                          <Button
                            size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => callAction(
                              { action: "extend_trial", tenant_id: t.id, days: extendDays[t.id] ?? 14 },
                              t.id, "Trial extended")}
                          >
                            Extend
                          </Button>
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setEditTenant(t)}>
                          <Pencil className="w-3.5 h-3.5 mr-2" /> Edit details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => impersonate(t)}>
                          <Eye className="w-3.5 h-3.5 mr-2" /> View as workspace
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <EditTenantDialog
        open={!!editTenant}
        onOpenChange={(o) => !o && setEditTenant(null)}
        tenant={editTenant ? { id: editTenant.id, name: editTenant.name, slug: editTenant.slug } : null}
        onSaved={load}
      />
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="glass-card p-4">
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon}{label}</div>
      <div className="text-2xl font-bold text-foreground mt-1">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "active" ? "bg-success/10 text-success"
    : status === "trialing" ? "bg-primary/10 text-primary"
    : status === "past_due" ? "bg-warning/10 text-warning"
    : status === "suspended" || status === "cancelled" ? "bg-destructive/10 text-destructive"
    : "bg-muted text-muted-foreground";
  return <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded ${cls}`}>{status}</span>;
}
