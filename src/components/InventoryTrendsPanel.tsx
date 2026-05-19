import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Clock, Download, Package } from "lucide-react";
import { useInventory, type InventoryItem, type InventoryTransaction } from "@/hooks/useInventory";
import { InventoryItemDetailsModal } from "@/components/InventoryItemDetailsModal";

interface ForecastRow {
  id: string;
  name: string;
  category: string;
  unit: string;
  stock: number;
  threshold: number;
  weeklyUse: number;
  daysToThreshold: number;
}

type RangeDays = 7 | 14 | 28;

// Match the colors from the reference screenshots.
const COLOR_STOCK = "#3b82f6";        // blue-500
const COLOR_STOCK_LOW = "#ef4444";    // red-500
const COLOR_THRESHOLD = "#cbd5e1";    // slate-300
const COLOR_USAGE = "#34d399";        // emerald-400 (teal-mint)
const COLOR_FORECAST_WARN = "#f59e0b"; // amber-500

const fmtDays = (d: number) => {
  if (!isFinite(d)) return "—";
  if (d <= 0) return "Now";
  return `${Math.round(d)}d left`;
};

const forecastTone = (d: number) => {
  if (!isFinite(d)) return "text-muted-foreground";
  if (d <= 7) return "text-destructive";
  if (d <= 14) return "text-warning";
  return "text-success";
};

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function InventoryTrendsPanel() {
  const { items, transactions } = useInventory();
  const [range, setRange] = useState<RangeDays>(28);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const rows = useMemo<ForecastRow[]>(() => {
    const since = Date.now() - range * 24 * 60 * 60 * 1000;
    const weeks = range / 7;
    return items.map((it) => {
      const consumed = transactions
        .filter((t) => t.itemId === it.id && t.type === "consume")
        .filter((t) => new Date(t.createdAt).getTime() >= since)
        .reduce((s, t) => s + Math.abs(t.delta), 0);
      const weeklyUse = consumed / weeks;
      const remaining = Math.max(0, it.quantity - it.threshold);
      const daysToThreshold = weeklyUse > 0 ? (remaining / weeklyUse) * 7 : Infinity;
      return {
        id: it.id,
        name: it.name,
        category: it.category,
        unit: it.unit,
        stock: it.quantity,
        threshold: it.threshold,
        weeklyUse: Math.round(weeklyUse * 10) / 10,
        daysToThreshold,
      };
    });
  }, [items, transactions, range]);

  const runningOut = rows.filter((r) => isFinite(r.daysToThreshold) && r.daysToThreshold > 0 && r.daysToThreshold <= 7).length;
  const lowSoon = rows.filter((r) => isFinite(r.daysToThreshold) && r.daysToThreshold > 7 && r.daysToThreshold <= 14).length;
  const belowNow = rows.filter((r) => r.stock <= r.threshold).length;

  const stockChartData = rows.map((r) => ({
    id: r.id,
    name: r.name,
    stock: r.stock,
    threshold: r.threshold,
    below: r.stock <= r.threshold,
  }));

  const usageChartData = rows
    .filter((r) => r.weeklyUse > 0)
    .sort((a, b) => b.weeklyUse - a.weeklyUse)
    .map((r) => ({ id: r.id, name: r.name, weeklyUse: r.weeklyUse }));

  const sortedForecast = [...rows].sort((a, b) => a.daysToThreshold - b.daysToThreshold);

  const exportForecast = () => {
    const header = ["Item", "Category", "Stock", "Unit", "Threshold", "Weekly Use", "Days to Threshold"];
    const data = sortedForecast.map((r) => [
      r.name, r.category, r.stock, r.unit, r.threshold, r.weeklyUse,
      isFinite(r.daysToThreshold) ? Math.round(r.daysToThreshold) : "",
    ]);
    downloadCsv(`depletion-forecast-${range}d.csv`, [header, ...data]);
  };

  const exportUsage = () => {
    const header = ["Item", "Weekly Use", "Range (days)"];
    const data = usageChartData.map((r) => [r.name, r.weeklyUse, range]);
    downloadCsv(`weekly-usage-${range}d.csv`, [header, ...data]);
  };

  const selectedItem: InventoryItem | null =
    items.find((i) => i.id === selectedItemId) ?? null;
  const selectedTransactions: InventoryTransaction[] = selectedItemId
    ? transactions.filter((t) => t.itemId === selectedItemId)
    : [];

  if (items.length === 0) {
    return (
      <div className="glass-card p-10 text-center text-sm text-muted-foreground">
        <Package className="w-8 h-8 mx-auto mb-3 text-muted-foreground/60" />
        No inventory items yet. Add items in the Inventory page to see trends here.
      </div>
    );
  }

  const RangeSelector = (
    <div className="inline-flex items-center p-1 rounded-full bg-secondary border border-border text-xs">
      {([7, 14, 28] as RangeDays[]).map((d) => (
        <button
          key={d}
          onClick={() => setRange(d)}
          className={`px-3 py-1 rounded-full font-medium transition-all ${
            range === d
              ? "bg-card text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {d}d
        </button>
      ))}
    </div>
  );

  const Legend = ({ items: legend }: { items: { color: string; label: string }[] }) => (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      {legend.map((l) => (
        <div key={l.label} className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: l.color }} />
          {l.label}
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-card p-5 border-destructive/40">
          <p className="text-4xl font-bold text-destructive text-center">{runningOut}</p>
          <p className="text-sm text-muted-foreground text-center mt-2">Running out ≤7d</p>
        </div>
        <div className="glass-card p-5 border-warning/40">
          <p className="text-4xl font-bold text-warning text-center">{lowSoon}</p>
          <p className="text-sm text-muted-foreground text-center mt-2">Low soon 8–14d</p>
        </div>
        <div className="glass-card p-5">
          <p className="text-4xl font-bold text-foreground text-center">{belowNow}</p>
          <p className="text-sm text-muted-foreground text-center mt-2">Below threshold now</p>
        </div>
      </div>

      {/* Stock vs threshold */}
      <div className="glass-card p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Current Stock vs Low-Stock Threshold</h3>
            <p className="text-sm text-muted-foreground">Click a bar to view item history. Red bars are below alert level.</p>
          </div>
          <Legend
            items={[
              { color: COLOR_STOCK, label: "Stock" },
              { color: COLOR_STOCK_LOW, label: "Below threshold" },
              { color: COLOR_THRESHOLD, label: "Threshold" },
            ]}
          />
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stockChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
              />
              <Bar
                dataKey="stock"
                name="Stock"
                radius={[6, 6, 0, 0]}
                cursor="pointer"
                onClick={(d: { id?: string }) => d?.id && setSelectedItemId(d.id)}
              >
                {stockChartData.map((d, i) => (
                  <Cell key={i} fill={d.below ? COLOR_STOCK_LOW : COLOR_STOCK} />
                ))}
              </Bar>
              <Bar
                dataKey="threshold"
                name="Threshold"
                fill={COLOR_THRESHOLD}
                radius={[6, 6, 0, 0]}
                cursor="pointer"
                onClick={(d: { id?: string }) => d?.id && setSelectedItemId(d.id)}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Weekly usage rate */}
      <div className="glass-card p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Estimated Weekly Usage Rate</h3>
            <p className="text-sm text-muted-foreground">Units consumed per week (estimated from stock history)</p>
          </div>
          <div className="flex items-center gap-2">
            <Legend items={[{ color: COLOR_USAGE, label: "Units / week" }]} />
            {RangeSelector}
            <button
              onClick={exportUsage}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
          </div>
        </div>
        <div className="h-72">
          {usageChartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              No consumption recorded in the last {range} days — usage will appear once orders deplete stock.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={usageChartData} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} width={120} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  cursor={{ fill: "hsl(var(--muted) / 0.3)" }}
                  formatter={(v: number) => [`${v}/wk`, "Usage"]}
                />
                <Bar
                  dataKey="weeklyUse"
                  fill={COLOR_USAGE}
                  radius={[0, 6, 6, 0]}
                  cursor="pointer"
                  onClick={(d: { id?: string }) => d?.id && setSelectedItemId(d.id)}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Depletion forecast table */}
      <div className="glass-card overflow-hidden">
        <div className="p-6 pb-3 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Depletion Forecast</h3>
            <p className="text-sm text-muted-foreground">Predicted days until each item hits its low-stock threshold (based on last {range} days)</p>
          </div>
          <div className="flex items-center gap-2">
            {RangeSelector}
            <button
              onClick={exportForecast}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 border-y border-border">
              <tr className="text-left text-muted-foreground">
                <th className="px-6 py-3 font-medium">Item</th>
                <th className="px-6 py-3 font-medium text-right">Stock</th>
                <th className="px-6 py-3 font-medium text-right">Threshold</th>
                <th className="px-6 py-3 font-medium text-right">Weekly Use</th>
                <th className="px-6 py-3 font-medium text-right">Forecast</th>
              </tr>
            </thead>
            <tbody>
              {sortedForecast.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setSelectedItemId(r.id)}
                  className="border-t border-border/60 hover:bg-secondary/30 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="font-semibold text-foreground">{r.name}</p>
                        <p className="text-xs text-muted-foreground">{r.category}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-right font-semibold text-foreground">
                    {r.stock} {r.unit}
                  </td>
                  <td className="px-6 py-3 text-right text-muted-foreground">
                    {r.threshold} {r.unit}
                  </td>
                  <td className="px-6 py-3 text-right text-muted-foreground">
                    {r.weeklyUse > 0 ? `${r.weeklyUse}/wk` : "—"}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <span
                      className={`inline-flex items-center gap-1.5 font-semibold ${forecastTone(r.daysToThreshold)}`}
                      style={
                        isFinite(r.daysToThreshold) && r.daysToThreshold > 7 && r.daysToThreshold <= 14
                          ? { color: COLOR_FORECAST_WARN }
                          : undefined
                      }
                    >
                      <Clock className="w-3.5 h-3.5" />
                      {fmtDays(r.daysToThreshold)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <InventoryItemDetailsModal
        open={selectedItem !== null}
        item={selectedItem}
        transactions={selectedTransactions}
        onOpenChange={(o) => { if (!o) setSelectedItemId(null); }}
      />
    </div>
  );
}
