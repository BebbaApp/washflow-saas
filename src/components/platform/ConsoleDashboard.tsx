import { useCallback, useEffect, useMemo, useState } from "react";
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
import { exportTablePdf } from "@/lib/pdfExport";

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
  const [configuredCategories, setConfiguredCategories] = useState<string[]>([]);

  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(isoDate(new Date()));
  const [tenantId, setTenantId] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    const body: any = { action: "platform_overview", from, to };
    if (tenantId !== "all") body.tenant_id = tenantId;
    const { data: res, error } = await supabase.functions.invoke("platform-admin", { body });
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else setData(res as Overview);
    setLoading(false);
  }, [from, to, tenantId, toast]);

  useEffect(() => {
    supabase.from("tenants" as any).select("id, name").order("name")
      .then(({ data }) => setTenants(((data as any) ?? []) as TenantRow[]));
    supabase.functions.invoke("platform-admin", { body: { action: "get_platform_settings" } })
      .then(({ data }) => {
        const c = (data as any)?.settings?.currency;
        if (c) setCurrency(c);
      });
  }, []);

  // Auto-refresh: re-run the platform overview when filters change, when the
  // tab regains focus, and on a 60s heartbeat so the console reflects new
  // data captured by tenants without requiring a manual reload.
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    const id = setInterval(load, 30_000);
    return () => { document.removeEventListener("visibilitychange", onVis); clearInterval(id); };
  }, [load]);

  useEffect(() => {
    const tables = ["orders", "expenses", "invoices", "tenant_members", "tenants"];
    const ch = supabase.channel(`platform-console-live-${crypto.randomUUID()}`);
    tables.forEach((table) => {
      ch.on("postgres_changes", { event: "*", schema: "public", table }, () => load());
    });
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  // Load configured categories for the selected tenant (used to enrich the breakdown).
  useEffect(() => {
    if (tenantId === "all") { setConfiguredCategories([]); return; }
    supabase
      .from("expense_categories" as any)
      .select("name, sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order")
      .order("name")
      .then(({ data }) => setConfiguredCategories(((data as any) ?? []).map((r: any) => r.name)));
  }, [tenantId]);

  const breakdown = useMemo(() => {
    const map = new Map<string, number>();
    (data?.expense_categories ?? []).forEach((c) => map.set(c.category, Number(c.amount || 0)));
    if (configuredCategories.length > 0) {
      const ordered: Array<{ category: string; amount: number }> = [];
      configuredCategories.forEach((name) => {
        ordered.push({ category: name, amount: map.get(name) ?? 0 });
        map.delete(name);
      });
      // append any ad-hoc categories not in the configured list
      Array.from(map.entries()).forEach(([category, amount]) => ordered.push({ category, amount }));
      return ordered;
    }
    return data?.expense_categories ?? [];
  }, [data, configuredCategories]);

  const fmt = useMemo(() => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency", currency, maximumFractionDigits: 0,
      });
    } catch {
      const num = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
      return { format: (v: number) => `${currency} ${num.format(v)}` } as Intl.NumberFormat;
    }
  }, [currency]);

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
        <Stat icon={<TrendingDown className="w-4 h-4" />} label="Expenses"
          value={data ? fmt.format(data.totals.expenses) : "—"}
          valueClass="text-destructive" />
        <Stat icon={<TrendingUp className="w-4 h-4" />} label="Net profit"
          value={data ? fmt.format(data.totals.net_profit) : "—"}
          valueClass={data && data.totals.net_profit < 0 ? "text-destructive" : "text-success"} />
        <Stat icon={<DollarSign className="w-4 h-4" />} label="Invoiced (paid)"
          value={data ? fmt.format(data.totals.invoice_revenue) : "—"} />
        <Stat icon={<ShoppingCart className="w-4 h-4" />} label="Orders"
          value={data ? `${data.totals.completed_orders}/${data.totals.orders}` : "—"}
          sub="completed / total" />
        <Stat icon={<Users className="w-4 h-4" />} label="Employees"
          value={data ? data.totals.employees.toString() : "—"}
          sub={data ? `${data.totals.tenants} tenants` : undefined} />
        <Stat icon={<Building2 className="w-4 h-4" />} label="Tenants"
          value={data ? data.totals.tenants.toString() : "—"} />
        <Stat icon={<DollarSign className="w-4 h-4" />} label="Avg order"
          value={data && data.totals.completed_orders > 0
            ? fmt.format(data.totals.revenue / data.totals.completed_orders) : "—"} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="glass-card p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold text-foreground mb-3">Revenue vs Expenses</h3>
          {data && data.series.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.series}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any) => fmt.format(Number(v))}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#rev)" strokeWidth={2} />
                <Area type="monotone" dataKey="expenses" stroke="hsl(var(--destructive))" fill="url(#exp)" strokeWidth={2} />
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

      <div className="glass-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Expenses by category</h3>
        {breakdown.length > 0 ? (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {breakdown.map((c) => (
              <li key={c.category} className="flex items-center justify-between gap-2 text-sm border border-border rounded-lg px-3 py-2">
                <span className="text-foreground truncate">{c.category}</span>
                <span className={`font-semibold whitespace-nowrap ${c.amount > 0 ? "text-destructive" : "text-muted-foreground"}`}>{fmt.format(c.amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground py-6 text-center">No expenses recorded in this range.</p>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub, valueClass }: { icon: React.ReactNode; label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="glass-card p-4">
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon}{label}</div>
      <div className={`text-2xl font-bold mt-1 ${valueClass ?? "text-foreground"}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
