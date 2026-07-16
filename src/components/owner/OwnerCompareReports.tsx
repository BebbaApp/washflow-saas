import { useMemo, useState } from "react";
import { useOwnerOverview } from "@/hooks/useOwnerOverview";
import { useCurrency } from "@/hooks/useCurrency";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, FileText } from "lucide-react";
import { exportTablePdf } from "@/lib/pdfExport";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";

const METRICS = [
  { key: "revenue", label: "Revenue" },
  { key: "expenses", label: "Expenses" },
  { key: "net", label: "Net (Rev − Exp)" },
  { key: "orders_count", label: "Cars washed" },
  { key: "avg_wait_minutes", label: "Avg wait (min)" },
  { key: "workers_total", label: "Workers" },
] as const;

export function OwnerCompareReports() {
  const { data, isLoading } = useOwnerOverview();
  const { formatPrice } = useCurrency();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("revenue");

  const tenants = data?.tenants ?? [];
  const active = selected.size ? tenants.filter((t) => selected.has(t.id)) : tenants;

  const chartData = useMemo(
    () =>
      active.map((t) => ({
        name: t.name,
        revenue: t.revenue,
        expenses: t.expenses,
        net: t.revenue - t.expenses,
        orders_count: t.orders_count,
        avg_wait_minutes: t.avg_wait_minutes,
        workers_total: t.workers_total,
      })),
    [active],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const exportCsv = () => {
    const headers = ["Workspace", "Revenue", "Expenses", "Net", "Orders", "Completed", "Avg wait (min)", "Workers", "Top service"];
    const rows = active.map((t) => [
      t.name, t.revenue, t.expenses, t.revenue - t.expenses, t.orders_count,
      t.completed_count, t.avg_wait_minutes, t.workers_total, t.top_service ?? "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => JSON.stringify(c ?? "")).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `workspaces-compare-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const headers = ["Workspace", "Revenue", "Expenses", "Net", "Orders", "Completed", "Avg wait (min)", "Workers", "Top service"];
    const rows = active.map((t) => [
      t.name,
      formatPrice(t.revenue),
      formatPrice(t.expenses),
      formatPrice(t.revenue - t.expenses),
      t.orders_count,
      t.completed_count,
      t.avg_wait_minutes,
      t.workers_total,
      t.top_service ?? "",
    ]);
    exportTablePdf({
      title: "Workspaces comparison",
      filename: `workspaces-compare-${new Date().toISOString().slice(0, 10)}.pdf`,
      headers,
      rows,
    });
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="glass-card p-4">
        <p className="text-xs font-medium text-muted-foreground mb-2">Include workspaces</p>
        <div className="flex flex-wrap gap-3">
          {tenants.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={selected.size === 0 || selected.has(t.id)} onCheckedChange={() => toggle(t.id)} />
              {t.name}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {METRICS.map((m) => (
          <Button key={m.key} size="sm" variant={metric === m.key ? "default" : "outline"} onClick={() => setMetric(m.key)}>
            {m.label}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} className="gap-1">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
          <Button size="sm" variant="outline" onClick={exportPdf} className="gap-1">
            <FileText className="w-3.5 h-3.5" /> Export PDF
          </Button>
        </div>
      </div>

      <div className="glass-card p-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey={metric} fill="hsl(var(--primary))" name={METRICS.find((m) => m.key === metric)!.label} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-left p-3">Workspace</th>
              <th className="text-right p-3">Revenue</th>
              <th className="text-right p-3">Expenses</th>
              <th className="text-right p-3">Net</th>
              <th className="text-right p-3">Cars</th>
              <th className="text-right p-3">Avg wait</th>
              <th className="text-right p-3">Workers</th>
              <th className="text-left p-3">Top service</th>
            </tr>
          </thead>
          <tbody>
            {active.map((t) => (
              <tr key={t.id} className="border-t border-border/50">
                <td className="p-3 font-medium">{t.name}</td>
                <td className="p-3 text-right">{formatPrice(t.revenue)}</td>
                <td className="p-3 text-right">{formatPrice(t.expenses)}</td>
                <td className="p-3 text-right">{formatPrice(t.revenue - t.expenses)}</td>
                <td className="p-3 text-right">{t.orders_count}</td>
                <td className="p-3 text-right">{t.avg_wait_minutes}m</td>
                <td className="p-3 text-right">{t.workers_total}</td>
                <td className="p-3">{t.top_service ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
