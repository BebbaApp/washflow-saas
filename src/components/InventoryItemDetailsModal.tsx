import { useMemo } from "react";
import { Package, ArrowDownCircle, ArrowUpCircle, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { InventoryItem, InventoryTransaction } from "@/hooks/useInventory";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface Props {
  open: boolean;
  item: InventoryItem | null;
  transactions: InventoryTransaction[];
  onOpenChange: (open: boolean) => void;
}

const fmtDate = (s: string) =>
  new Date(s).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function InventoryItemDetailsModal({ open, item, transactions, onOpenChange }: Props) {
  // Build stock-history series (oldest → newest) using the recorded balance.
  const history = useMemo(() => {
    if (!item) return [];
    return [...transactions]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((t) => ({
        time: new Date(t.createdAt).getTime(),
        label: fmtDate(t.createdAt),
        balance: t.balance,
      }));
  }, [item, transactions]);

  const consumed = transactions.filter((t) => t.type === "consume").reduce((s, t) => s + Math.abs(t.delta), 0);
  const restocked = transactions.filter((t) => t.type === "restock").reduce((s, t) => s + t.delta, 0);
  const adjustments = transactions.filter((t) => t.type === "adjust").length;

  if (!item) return null;

  const isLow = item.quantity <= item.threshold;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            {item.name}
          </DialogTitle>
          <DialogDescription>
            {item.category}{item.subtype ? ` · ${item.subtype}` : ""} — stock history and consumption transactions
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Quick stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="glass-card p-3 text-center">
              <p className="text-xs text-muted-foreground">Current</p>
              <p className={`text-2xl font-bold ${isLow ? "text-destructive" : "text-foreground"}`}>
                {Number(item.quantity).toFixed(2)}
              </p>
              <p className="text-[11px] text-muted-foreground">{item.unit}</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-xs text-muted-foreground">Threshold</p>
              <p className="text-2xl font-bold text-foreground">{Number(item.threshold).toFixed(2)}</p>
              <p className="text-[11px] text-muted-foreground">{item.unit}</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-xs text-muted-foreground">Consumed</p>
              <p className="text-2xl font-bold text-foreground">{Number(consumed).toFixed(2)}</p>
              <p className="text-[11px] text-muted-foreground">all-time</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-xs text-muted-foreground">Restocked</p>
              <p className="text-2xl font-bold text-foreground">{Number(restocked).toFixed(2)}</p>
              <p className="text-[11px] text-muted-foreground">{adjustments} adjustments</p>
            </div>
          </div>

          {/* Stock history chart */}
          <div className="glass-card p-4">
            <h4 className="text-sm font-semibold text-foreground mb-2">Stock History</h4>
            <div className="h-56">
              {history.length < 2 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  Not enough history yet to plot a trend.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} hide={history.length > 8} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => [`${Number(v).toFixed(2)} ${item.unit}`, "Balance"]}
                    />
                    <ReferenceLine y={item.threshold} stroke="hsl(var(--destructive))" strokeDasharray="4 4" label={{ value: "Threshold", fill: "hsl(var(--destructive))", fontSize: 11, position: "insideTopLeft" }} />
                    <Line type="monotone" dataKey="balance" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Transactions */}
          <div className="glass-card overflow-hidden">
            <div className="p-4 pb-2">
              <h4 className="text-sm font-semibold text-foreground">Transactions</h4>
              <p className="text-xs text-muted-foreground">Most recent first</p>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {transactions.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">No transactions recorded.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-secondary/40 border-y border-border sticky top-0">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-4 py-2 font-medium">When</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="px-4 py-2 font-medium">Source</th>
                      <th className="px-4 py-2 font-medium text-right">Δ</th>
                      <th className="px-4 py-2 font-medium text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t) => {
                      const Icon = t.type === "consume" ? ArrowDownCircle : t.type === "restock" ? ArrowUpCircle : RefreshCw;
                      const tone = t.type === "consume" ? "text-destructive" : t.type === "restock" ? "text-success" : "text-info";
                      return (
                        <tr key={t.id} className="border-t border-border/60">
                          <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(t.createdAt)}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex items-center gap-1 ${tone}`}>
                              <Icon className="w-3.5 h-3.5" /> {t.type}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-foreground">
                            {t.source}
                            {t.notes && <span className="text-muted-foreground"> · {t.notes}</span>}
                          </td>
                          <td className={`px-4 py-2 text-right font-semibold ${t.delta < 0 ? "text-destructive" : "text-success"}`}>
                            {t.delta > 0 ? `+${Number(t.delta).toFixed(2)}` : Number(t.delta).toFixed(2)}
                          </td>
                          <td className="px-4 py-2 text-right font-semibold text-foreground">{Number(t.balance).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
