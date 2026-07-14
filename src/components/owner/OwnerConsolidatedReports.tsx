import { useOwnerOverview } from "@/hooks/useOwnerOverview";
import { useCurrency } from "@/hooks/useCurrency";
import { AlertTriangle, TrendingUp, TrendingDown, Users, Package } from "lucide-react";

export function OwnerConsolidatedReports() {
  const { data, isLoading } = useOwnerOverview();
  const { formatPrice } = useCurrency();

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const tenants = data?.tenants ?? [];
  const totals = tenants.reduce(
    (acc, t) => {
      acc.revenue += t.revenue;
      acc.expenses += t.expenses;
      acc.orders += t.orders_count;
      acc.workers += t.workers_total;
      acc.onShift += t.workers_on_shift;
      acc.low += t.inventory_low;
      return acc;
    },
    { revenue: 0, expenses: 0, orders: 0, workers: 0, onShift: 0, low: 0 },
  );
  const net = totals.revenue - totals.expenses;
  const attention = tenants.filter((t) =>
    t.status === "past_due" || t.status === "suspended" || t.inventory_low > 0,
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card icon={TrendingUp} label="Combined revenue" value={formatPrice(totals.revenue)} color="text-success" />
        <Card icon={TrendingDown} label="Combined expenses" value={formatPrice(totals.expenses)} color="text-warning" />
        <Card icon={TrendingUp} label="Net profit" value={formatPrice(net)} color={net >= 0 ? "text-success" : "text-destructive"} />
        <Card icon={Users} label="Workforce (on shift)" value={`${totals.workers} (${totals.onShift})`} color="text-info" />
      </div>

      <div className="glass-card p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Package className="w-4 h-4" /> P&L by workspace (MTD)
        </h3>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="text-left p-2">Workspace</th>
              <th className="text-right p-2">Revenue</th>
              <th className="text-right p-2">Expenses</th>
              <th className="text-right p-2">Net</th>
              <th className="text-right p-2">Margin</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => {
              const n = t.revenue - t.expenses;
              const margin = t.revenue > 0 ? Math.round((n / t.revenue) * 100) : 0;
              return (
                <tr key={t.id} className="border-t border-border/50">
                  <td className="p-2 font-medium">{t.name}</td>
                  <td className="p-2 text-right">{formatPrice(t.revenue)}</td>
                  <td className="p-2 text-right">{formatPrice(t.expenses)}</td>
                  <td className={`p-2 text-right ${n >= 0 ? "text-success" : "text-destructive"}`}>{formatPrice(n)}</td>
                  <td className="p-2 text-right">{margin}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="glass-card p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-warning" /> Attention
        </h3>
        {attention.length === 0 ? (
          <p className="text-sm text-muted-foreground">All workspaces healthy.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {attention.map((t) => (
              <li key={t.id} className="flex items-center justify-between border-b border-border/40 pb-2 last:border-0">
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t.status !== "active" && t.status !== "trialing" ? `Billing: ${t.status.replace("_", " ")} · ` : ""}
                  {t.inventory_low > 0 ? `${t.inventory_low} low-stock item(s)` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Card({ icon: Icon, label, value, color }: any) {
  return (
    <div className="glass-card p-4">
      <Icon className={`w-4 h-4 ${color}`} />
      <p className="stat-value text-foreground mt-2">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}
