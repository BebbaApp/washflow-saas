import { useEffect, useMemo, useState } from "react";
import { Loader2, DollarSign, ShoppingCart, Users, Building2, Download, FileText, TrendingDown, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

interface Overview {
  range: { from: string; to: string };
  totals: {
    orders: number;
    completed_orders: number;
    revenue: number;
    invoice_revenue: number;
    expenses: number;
    net_profit: number;
    tenants: number;
    employees: number;
  };
  top_services: Array<{ service: string; count: number; revenue: number }>;
  expense_categories: Array<{ category: string; amount: number }>;
  series: Array<{ date: string; revenue: number; expenses: number }>;
}

interface TenantRow { id: string; name: string }

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function ConsoleDashboard() {
  const { toast } = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [currency, setCurrency] = useState("USD");

  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(isoDate(new Date()));
  const [tenantId, setTenantId] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    const body: any = { action: "platform_overview", from, to };
    if (tenantId !== "all") body.tenant_id = tenantId;
    const { data: res, error } = await supabase.functions.invoke("platform-admin", { body });
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else setData(res as Overview);
    setLoading(false);
  };

  useEffect(() => {
    supabase.from("tenants" as any).select("id, name").order("name")
      .then(({ data }) => setTenants(((data as any) ?? []) as TenantRow[]));
    supabase.functions.invoke("platform-admin", { body: { action: "get_platform_settings" } })
      .then(({ data }) => {
        const c = (data as any)?.settings?.currency;
        if (c) setCurrency(c);
      });
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmt = useMemo(() => new Intl.NumberFormat(undefined, {
    style: "currency", currency, maximumFractionDigits: 0,
  }), [currency]);

  const exportCsv = () => {
    if (!data) return;
    const lines: string[] = [];
    lines.push("Section,Key,Value");
    lines.push(`Range,From,${data.range.from}`);
    lines.push(`Range,To,${data.range.to}`);
    Object.entries(data.totals).forEach(([k, v]) => lines.push(`Totals,${k},${v}`));
    lines.push("");
    lines.push("Top services,Service,Count,Revenue");
    data.top_services.forEach((s) => lines.push(`,${s.service},${s.count},${s.revenue}`));
    lines.push("");
    lines.push("Expenses by category,Category,Amount");
    data.expense_categories.forEach((c) => lines.push(`,${c.category},${c.amount}`));
    lines.push("");
    lines.push("Daily,Date,Revenue,Expenses");
    data.series.forEach((s) => lines.push(`,${s.date},${s.revenue},${s.expenses}`));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `console-report-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="glass-card p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tenant</Label>
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tenants</SelectItem>
                {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply filters"}
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={exportCsv} disabled={!data}>
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
          <Button variant="outline" onClick={() => window.print()} disabled={!data}>
            <FileText className="w-4 h-4 mr-2" /> Print report
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={<DollarSign className="w-4 h-4" />} label="Order revenue"
          value={data ? fmt.format(data.totals.revenue) : "—"} />
        <Stat icon={<DollarSign className="w-4 h-4" />} label="Invoiced (paid)"
          value={data ? fmt.format(data.totals.invoice_revenue) : "—"} />
        <Stat icon={<ShoppingCart className="w-4 h-4" />} label="Orders"
          value={data ? `${data.totals.completed_orders}/${data.totals.orders}` : "—"}
          sub="completed / total" />
        <Stat icon={<Users className="w-4 h-4" />} label="Employees"
          value={data ? data.totals.employees.toString() : "—"}
          sub={data ? `${data.totals.tenants} tenants` : undefined} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="glass-card p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold text-foreground mb-3">Revenue over time</h3>
          {data && data.series.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.series}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any) => fmt.format(Number(v))}
                />
                <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#rev)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground py-12 text-center">No data in this range.</p>
          )}
        </div>

        <div className="glass-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Top services sold</h3>
          {data && data.top_services.length > 0 ? (
            <ul className="space-y-2">
              {data.top_services.map((s) => (
                <li key={s.service} className="flex items-center justify-between gap-2 text-sm border-b border-border pb-2 last:border-0">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">{s.service}</div>
                    <div className="text-[11px] text-muted-foreground">{s.count} sold</div>
                  </div>
                  <div className="text-sm font-semibold text-primary whitespace-nowrap">{fmt.format(s.revenue)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">No completed orders.</p>
          )}
        </div>
      </div>

      <div className="glass-card p-4 text-xs text-muted-foreground flex items-start gap-2">
        <Building2 className="w-4 h-4 mt-0.5 shrink-0" />
        <p>
          Expense data is stored per-tenant in browser local storage and is not aggregated centrally.
          To include expenses in the console dashboard, migrate them to a shared <code>expenses</code> table.
        </p>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="glass-card p-4">
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon}{label}</div>
      <div className="text-2xl font-bold text-foreground mt-1">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
