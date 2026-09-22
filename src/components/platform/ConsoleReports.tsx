import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2, Download, FileText, BarChart3, TrendingUp, TrendingDown,
  DollarSign, Building2, ShoppingCart, Calendar,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, XAxis, YAxis,
  Tooltip, CartesianGrid, Legend,
} from "recharts";
import { exportTablePdf } from "@/lib/pdfExport";

interface TenantBreakdown {
  id: string; name: string; revenue: number; expenses: number;
  orders: number; completed: number;
}
interface Overview {
  range: { from: string; to: string };
  totals: {
    orders: number; completed_orders: number; revenue: number;
    invoice_revenue: number; expenses: number; net_profit: number;
    tenants: number; employees: number;
  };
  top_services: Array<{ service: string; count: number; revenue: number }>;
  expense_categories: Array<{ category: string; amount: number }>;
  tenant_breakdown: TenantBreakdown[];
  series: Array<{ date: string; revenue: number; expenses: number }>;
}

interface TenantRow { id: string; name: string }

type ReportType = "summary" | "tenant_pnl" | "revenue_trend" | "top_services" | "expense_breakdown";

const REPORTS: { id: ReportType; label: string; icon: typeof BarChart3 }[] = [
  { id: "summary", label: "P&L Summary", icon: DollarSign },
  { id: "tenant_pnl", label: "P&L by Workspace", icon: Building2 },
  { id: "revenue_trend", label: "Revenue Trend", icon: TrendingUp },
  { id: "top_services", label: "Top Services", icon: ShoppingCart },
  { id: "expense_breakdown", label: "Expense Breakdown", icon: TrendingDown },
];

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export function ConsoleReports() {
  const { toast } = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [currency, setCurrency] = useState("USD");

  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(isoDate(new Date()));
  const [tenantId, setTenantId] = useState<string>("all");
  const [reportType, setReportType] = useState<ReportType>("summary");

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

  useEffect(() => { load(); }, [load]);

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
    const rpt = REPORTS.find((r) => r.id === reportType)?.label ?? "Report";
    lines.push(`Report,${rpt}`);
    lines.push(`Range,${fmtDate(data.range.from)} to ${fmtDate(data.range.to)}`);
    lines.push("");

    if (reportType === "summary") {
      lines.push("Metric,Value");
      Object.entries(data.totals).forEach(([k, v]) => lines.push(`${k},${v}`));
    } else if (reportType === "tenant_pnl") {
      lines.push("Workspace,Revenue,Expenses,Net,Margin %,Orders,Completed");
      data.tenant_breakdown.forEach((t) => {
        const net = t.revenue - t.expenses;
        const margin = t.revenue > 0 ? Math.round((net / t.revenue) * 100) : 0;
        lines.push(`${t.name},${t.revenue},${t.expenses},${net},${margin},${t.orders},${t.completed}`);
      });
    } else if (reportType === "revenue_trend") {
      lines.push("Date,Revenue,Expenses,Net");
      data.series.forEach((s) => lines.push(`${fmtDate(s.date)},${s.revenue},${s.expenses},${s.revenue - s.expenses}`));
    } else if (reportType === "top_services") {
      lines.push("Service,Count,Revenue");
      data.top_services.forEach((s) => lines.push(`${s.service},${s.count},${s.revenue}`));
    } else if (reportType === "expense_breakdown") {
      lines.push("Category,Amount");
      data.expense_categories.forEach((c) => lines.push(`${c.category},${c.amount}`));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `platform-${reportType}-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    if (!data) return;
    const rpt = REPORTS.find((r) => r.id === reportType)?.label ?? "Report";
    const rows: (string | number)[][] = [];

    if (reportType === "summary") {
      rows.push(["Order revenue", fmt.format(data.totals.revenue)]);
      rows.push(["Expenses", fmt.format(data.totals.expenses)]);
      rows.push(["Net profit", fmt.format(data.totals.net_profit)]);
      rows.push(["Invoiced (paid)", fmt.format(data.totals.invoice_revenue)]);
      rows.push(["Orders", `${data.totals.completed_orders} / ${data.totals.orders}`]);
      rows.push(["Tenants", data.totals.tenants]);
      rows.push(["Employees", data.totals.employees]);
      exportTablePdf({
        title: `Platform Report — ${rpt}`,
        subtitle: `Range: ${fmtDate(data.range.from)} → ${fmtDate(data.range.to)}`,
        filename: `platform-${reportType}-${from}_${to}.pdf`,
        headers: ["Metric", "Value"],
        rows,
      });
    } else if (reportType === "tenant_pnl") {
      data.tenant_breakdown.forEach((t) => {
        const net = t.revenue - t.expenses;
        const margin = t.revenue > 0 ? Math.round((net / t.revenue) * 100) : 0;
        rows.push([t.name, fmt.format(t.revenue), fmt.format(t.expenses), fmt.format(net), `${margin}%`, `${t.completed}/${t.orders}`]);
      });
      exportTablePdf({
        title: `Platform Report — ${rpt}`,
        subtitle: `Range: ${fmtDate(data.range.from)} → ${fmtDate(data.range.to)}`,
        filename: `platform-${reportType}-${from}_${to}.pdf`,
        headers: ["Workspace", "Revenue", "Expenses", "Net", "Margin", "Completed/Orders"],
        rows,
      });
    } else if (reportType === "revenue_trend") {
      data.series.forEach((s) => {
        rows.push([fmtDate(s.date), fmt.format(s.revenue), fmt.format(s.expenses), fmt.format(s.revenue - s.expenses)]);
      });
      exportTablePdf({
        title: `Platform Report — ${rpt}`,
        subtitle: `Range: ${fmtDate(data.range.from)} → ${fmtDate(data.range.to)}`,
        filename: `platform-${reportType}-${from}_${to}.pdf`,
        headers: ["Date", "Revenue", "Expenses", "Net"],
        rows,
      });
    } else if (reportType === "top_services") {
      data.top_services.forEach((s) => {
        rows.push([s.service, `${s.count}`, fmt.format(s.revenue)]);
      });
      exportTablePdf({
        title: `Platform Report — ${rpt}`,
        subtitle: `Range: ${fmtDate(data.range.from)} → ${fmtDate(data.range.to)}`,
        filename: `platform-${reportType}-${from}_${to}.pdf`,
        headers: ["Service", "Count", "Revenue"],
        rows,
      });
    } else if (reportType === "expense_breakdown") {
      data.expense_categories.forEach((c) => {
        rows.push([c.category, fmt.format(c.amount)]);
      });
      exportTablePdf({
        title: `Platform Report — ${rpt}`,
        subtitle: `Range: ${fmtDate(data.range.from)} → ${fmtDate(data.range.to)}`,
        filename: `platform-${reportType}-${from}_${to}.pdf`,
        headers: ["Category", "Amount"],
        rows,
      });
    }
  };

  const activeReport = REPORTS.find((r) => r.id === reportType);

  return (
    <div className="space-y-4">
      {/* Report type selector */}
      <div className="glass-card p-4">
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" /> Reports
        </h2>
        <div className="flex flex-wrap gap-2">
          {REPORTS.map((r) => {
            const Icon = r.icon;
            return (
              <button
                key={r.id}
                onClick={() => setReportType(r.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  reportType === r.id
                    ? "bg-primary/15 text-primary"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {r.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1"><Calendar className="w-3 h-3" /> From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1"><Calendar className="w-3 h-3" /> To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Workspace</Label>
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All workspaces</SelectItem>
                {tenants.map((t) => <SelectItem key={1} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Generate"}
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={exportCsv} disabled={!data}>
            <Download className="w-4 h-4 mr-2" /> CSV
          </Button>
          <Button variant="outline" onClick={exportPdf} disabled={!data}>
            <FileText className="w-4 h-4 mr-2" /> PDF
          </Button>
        </div>
      </div>

      {/* Report body */}
      <div className="glass-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-4">
          {activeReport?.label}
          {data && <span className="ml-2 text-xs text-muted-foreground font-normal">{fmtDate(data.range.from)} → {fmtDate(data.range.to)}</span>}
        </h3>

        {loading && !data ? (
          <div className="py-12 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Generating report…
          </div>
        ) : !data ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No data. Click Generate.</div>
        ) : reportType === "summary" ? (
          <SummaryReport data={data} fmt={fmt} />
        ) : reportType === "tenant_pnl" ? (
          <TenantPnlReport data={data} fmt={fmt} />
        ) : reportType === "revenue_trend" ? (
          <RevenueTrendReport data={data} fmt={fmt} />
        ) : reportType === "top_services" ? (
          <TopServicesReport data={data} fmt={fmt} />
        ) : (
          <ExpenseBreakdownReport data={data} fmt={fmt} />
        )}
      </div>
    </div>
  );
}

/* ── Report renderers ── */

function SummaryReport({ data, fmt }: { data: Overview; fmt: Intl.NumberFormat }) {
  const t = data.totals;
  const avgOrder = t.completed_orders > 0 ? t.revenue / t.completed_orders : 0;
  const stats = [
    { label: "Order revenue", value: fmt.format(t.revenue), icon: DollarSign, color: "text-success" },
    { label: "Expenses", value: fmt.format(t.expenses), icon: TrendingDown, color: "text-destructive" },
    { label: "Net profit", value: fmt.format(t.net_profit), icon: TrendingUp, color: t.net_profit >= 0 ? "text-success" : "text-destructive" },
    { label: "Invoiced (paid)", value: fmt.format(t.invoice_revenue), icon: FileText, color: "text-info" },
    { label: "Orders", value: `${t.completed_orders} / ${t.orders}`, icon: ShoppingCart, color: "text-foreground", sub: "completed / total" },
    { label: "Avg order value", value: fmt.format(avgOrder), icon: DollarSign, color: "text-foreground" },
    { label: "Workspaces", value: `${t.tenants}`, icon: Building2, color: "text-foreground" },
    { label: "Employees", value: `${t.employees}`, icon: ShoppingCart, color: "text-foreground" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <div key={s.label} className="rounded-lg border border-border bg-secondary/30 p-4">
            <Icon className={`w-4 h-4 ${s.color}`} />
            <p className="text-xl font-bold text-foreground mt-2">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}{s.sub ? ` · ${s.sub}` : ""}</p>
          </div>
        );
      })}
    </div>
  );
}

function TenantPnlReport({ data, fmt }: { data: Overview; fmt: Intl.NumberFormat }) {
  const rows = data.tenant_breakdown;
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="text-left p-2">Workspace</th>
            <th className="text-right p-2">Revenue</th>
            <th className="text-right p-2">Expenses</th>
            <th className="text-right p-2">Net</th>
            <th className="text-right p-2">Margin</th>
            <th className="text-right p-2">Orders</th>
            <th className="text-right p-2">Completed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const net = t.revenue - t.expenses;
            const margin = t.revenue > 0 ? Math.round((net / t.revenue) * 100) : 0;
            return (
              <tr key={t.id} className="border-t border-border/50 hover:bg-secondary/30">
                <td className="p-2 font-medium text-foreground">{t.name}</td>
                <td className="p-2 text-right">{fmt.format(t.revenue)}</td>
                <td className="p-2 text-right text-destructive">{fmt.format(t.expenses)}</td>
                <td className={`p-2 text-right font-semibold ${net >= 0 ? "text-success" : "text-destructive"}`}>{fmt.format(net)}</td>
                <td className="p-2 text-right">{margin}%</td>
                <td className="p-2 text-right text-muted-foreground">{t.orders}</td>
                <td className="p-2 text-right text-muted-foreground">{t.completed}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-semibold">
            <td className="p-2">Total</td>
            <td className="p-2 text-right">{fmt.format(rows.reduce((s, t) => s + t.revenue, 0))}</td>
            <td className="p-2 text-right text-destructive">{fmt.format(rows.reduce((s, t) => s + t.expenses, 0))}</td>
            <td className="p-2 text-right text-success">{fmt.format(rows.reduce((s, t) => s + (t.revenue - t.expenses), 0))}</td>
            <td className="p-2 text-right text-muted-foreground" colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function RevenueTrendReport({ data, fmt }: { data: Overview; fmt: Intl.NumberFormat }) {
  if (data.series.length === 0) return <Empty />;
  const chartData = data.series.map((s) => ({
    ...s,
    date: fmtDate(s.date),
    net: s.revenue - s.expenses,
  }));
  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="rpt-rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="rpt-exp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.35} />
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
          <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#rpt-rev)" strokeWidth={2} />
          <Area type="monotone" dataKey="expenses" stroke="hsl(var(--destructive))" fill="url(#rpt-exp)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="text-left p-2">Date</th>
              <th className="text-right p-2">Revenue</th>
              <th className="text-right p-2">Expenses</th>
              <th className="text-right p-2">Net</th>
            </tr>
          </thead>
          <tbody>
            {data.series.map((s) => (
              <tr key={s.date} className="border-t border-border/50">
                <td className="p-2 font-medium">{fmtDate(s.date)}</td>
                <td className="p-2 text-right">{fmt.format(s.revenue)}</td>
                <td className="p-2 text-right text-destructive">{fmt.format(s.expenses)}</td>
                <td className={`p-2 text-right ${s.revenue - s.expenses >= 0 ? "text-success" : "text-destructive"}`}>
                  {fmt.format(s.revenue - s.expenses)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TopServicesReport({ data, fmt }: { data: Overview; fmt: Intl.NumberFormat }) {
  const rows = data.top_services;
  if (rows.length === 0) return <Empty />;
  const chartData = rows.map((s) => ({ service: s.service, count: s.count, revenue: s.revenue }));
  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis dataKey="service" type="category" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={100} />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
            formatter={(v: any, name: string) => name === "revenue" ? fmt.format(Number(v)) : v}
          />
          <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="text-left p-2">#</th>
            <th className="text-left p-2">Service</th>
            <th className="text-right p-2">Count</th>
            <th className="text-right p-2">Revenue</th>
            <th className="text-right p-2">Avg price</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={s.service} className="border-t border-border/50">
              <td className="p-2 text-muted-foreground">{i + 1}</td>
              <td className="p-2 font-medium text-foreground">{s.service}</td>
              <td className="p-2 text-right">{s.count}</td>
              <td className="p-2 text-right text-primary font-semibold">{fmt.format(s.revenue)}</td>
              <td className="p-2 text-right text-muted-foreground">{fmt.format(s.count > 0 ? s.revenue / s.count : 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpenseBreakdownReport({ data, fmt }: { data: Overview; fmt: Intl.NumberFormat }) {
  const rows = data.expense_categories;
  if (rows.length === 0) return <Empty />;
  const total = rows.reduce((s, c) => s + c.amount, 0);
  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={rows} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis dataKey="category" type="category" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={120} />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
            formatter={(v: any) => fmt.format(Number(v))}
          />
          <Bar dataKey="amount" fill="hsl(var(--destructive))" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="text-left p-2">Category</th>
            <th className="text-right p-2">Amount</th>
            <th className="text-right p-2">% of total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.category} className="border-t border-border/50">
              <td className="p-2 font-medium text-foreground">{c.category}</td>
              <td className="p-2 text-right text-destructive font-semibold">{fmt.format(c.amount)}</td>
              <td className="p-2 text-right text-muted-foreground">{total > 0 ? Math.round((c.amount / total) * 100) : 0}%</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-semibold">
            <td className="p-2">Total</td>
            <td className="p-2 text-right text-destructive">{fmt.format(total)}</td>
            <td className="p-2 text-right text-muted-foreground">100%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Empty() {
  return <p className="py-12 text-center text-sm text-muted-foreground">No data for this report in the selected range.</p>;
}
