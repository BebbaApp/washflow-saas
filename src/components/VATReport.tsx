import { useMemo } from "react";
import { Receipt, PieChart as PieChartIcon, TrendingUp, AlertTriangle } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import type { WashOrder } from "@/hooks/useOrders";
import { useCurrency } from "@/hooks/useCurrency";
import { useServices } from "@/hooks/useServices";

const COLORS = [
  "hsl(185, 72%, 48%)",
  "hsl(152, 60%, 45%)",
  "hsl(38, 92%, 55%)",
  "hsl(210, 80%, 55%)",
  "hsl(350, 89%, 60%)",
  "hsl(262, 83%, 66%)",
];

interface VATReportProps {
  orders: WashOrder[];
}

export function VATReport({ orders }: VATReportProps) {
  const { currency, formatPrice } = useCurrency();
  const { services } = useServices();

  const report = useMemo(() => {
    const serviceMap = new Map(services.map((s) => [s.id, s]));

    let totalRevenue = 0;
    let totalVat = 0;
    let totalExempt = 0;
    const byService: Record<string, { name: string; revenue: number; vat: number; count: number; exempt: boolean }> = {};

    orders.forEach((o) => {
      const svc = serviceMap.get(o.service);
      const isExempt = svc?.vatExempt ?? false;
      const price = o.servicePrice;
      const vat = !isExempt && currency.vatEnabled ? +(price * currency.vatPercent / 100).toFixed(2) : 0;

      totalRevenue += price;
      totalVat += vat;
      if (isExempt) totalExempt += price;

      if (!byService[o.service]) {
        byService[o.service] = { name: svc?.name || o.service, revenue: 0, vat: 0, count: 0, exempt: isExempt };
      }
      byService[o.service].revenue += price;
      byService[o.service].vat += vat;
      byService[o.service].count++;
    });

    const serviceBreakdown = Object.values(byService).sort((a, b) => b.vat - a.vat);
    const vatPieData = serviceBreakdown.filter((s) => s.vat > 0).map((s) => ({ name: s.name, value: +s.vat.toFixed(2) }));

    return { totalRevenue, totalVat, totalExempt, serviceBreakdown, vatPieData };
  }, [orders, services, currency]);

  if (!currency.vatEnabled) {
    return (
      <div className="glass-card p-8 text-center">
        <AlertTriangle className="w-8 h-8 text-warning mx-auto mb-3" />
        <p className="text-sm font-medium text-foreground mb-1">VAT is not enabled</p>
        <p className="text-xs text-muted-foreground">Enable VAT in Settings → Currency to view VAT reports.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <Receipt className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">Total Revenue</p>
          </div>
          <p className="stat-value text-foreground">{formatPrice(report.totalRevenue)}</p>
        </div>
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-success" />
            <p className="text-xs text-muted-foreground">VAT Collected</p>
          </div>
          <p className="stat-value text-foreground">{formatPrice(report.totalVat)}</p>
          <p className="text-xs text-muted-foreground mt-1">at {currency.vatPercent}%</p>
        </div>
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <PieChartIcon className="w-4 h-4 text-info" />
            <p className="text-xs text-muted-foreground">Revenue + VAT</p>
          </div>
          <p className="stat-value text-foreground">{formatPrice(report.totalRevenue + report.totalVat)}</p>
        </div>
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <p className="text-xs text-muted-foreground">VAT-Exempt Revenue</p>
          </div>
          <p className="stat-value text-foreground">{formatPrice(report.totalExempt)}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* VAT by Service Pie */}
        <div className="glass-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-4">VAT by Service Type</h4>
          {report.vatPieData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={report.vatPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${formatPrice(value)}`}>
                    {report.vatPieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} labelStyle={{ color: "hsl(var(--foreground))" }} itemStyle={{ color: "hsl(var(--foreground))" }} formatter={(value: number) => formatPrice(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No VAT data to display</p>
          )}
        </div>

        {/* VAT by Service Bar */}
        <div className="glass-card p-5">
          <h4 className="text-sm font-semibold text-foreground mb-4">Revenue & VAT Breakdown</h4>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={report.serviceBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 18%, 22%)" />
                <XAxis dataKey="name" tick={{ fill: "hsl(215, 15%, 55%)", fontSize: 11 }} />
                <YAxis tick={{ fill: "hsl(215, 15%, 55%)", fontSize: 12 }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }} labelStyle={{ color: "hsl(var(--foreground))" }} itemStyle={{ color: "hsl(var(--foreground))" }} formatter={(value: number) => formatPrice(value)} />
                <Bar dataKey="revenue" name="Revenue" fill="hsl(185, 72%, 48%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="vat" name="VAT" fill="hsl(152, 60%, 45%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Service Table */}
      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h4 className="text-sm font-semibold text-foreground">Service-Level VAT Detail</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs text-muted-foreground font-medium">Service</th>
                <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Orders</th>
                <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Revenue</th>
                <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">VAT</th>
                <th className="text-right px-4 py-3 text-xs text-muted-foreground font-medium">Total</th>
                <th className="text-center px-4 py-3 text-xs text-muted-foreground font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {report.serviceBreakdown.map((s) => (
                <tr key={s.name} className="border-b border-border/50">
                  <td className="px-4 py-3 text-foreground font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">{s.count}</td>
                  <td className="px-4 py-3 text-right font-mono text-foreground">{formatPrice(s.revenue)}</td>
                  <td className="px-4 py-3 text-right font-mono text-foreground">{formatPrice(s.vat)}</td>
                  <td className="px-4 py-3 text-right font-mono text-foreground font-semibold">{formatPrice(s.revenue + s.vat)}</td>
                  <td className="px-4 py-3 text-center">
                    {s.exempt ? (
                      <span className="text-[10px] bg-warning/10 text-warning px-2 py-0.5 rounded-full font-medium">Exempt</span>
                    ) : (
                      <span className="text-[10px] bg-success/10 text-success px-2 py-0.5 rounded-full font-medium">Taxable</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
