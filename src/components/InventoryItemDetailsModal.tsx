import { useMemo, useState } from "react";
import { Package, ArrowDownCircle, ArrowUpCircle, RefreshCw, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
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
  new Date(s).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

type TxTab = "all" | "restock" | "consume";

export function InventoryItemDetailsModal({ open, item, transactions, onOpenChange }: Props) {
  const [txTab, setTxTab] = useState<TxTab>("all");
  const [zoom, setZoom] = useState(1); // 1 = show all; higher = show most recent slice

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

  const zoomedHistory = useMemo(() => {
    if (history.length === 0) return history;
    const visibleCount = Math.max(2, Math.ceil(history.length / zoom));
    return history.slice(-visibleCount);
  }, [history, zoom]);

  const consumed = transactions.filter((t) => t.type === "consume").reduce((s, t) => s + Math.abs(t.delta), 0);
  const restocked = transactions.filter((t) => t.type === "restock").reduce((s, t) => s + t.delta, 0);
  const adjustments = transactions.filter((t) => t.type === "adjust").length;

  const restockTx = transactions.filter((t) => t.type === "restock");
  const consumeTx = transactions.filter((t) => t.type === "consume");
  const visibleTx = txTab === "restock" ? restockTx : txTab === "consume" ? consumeTx : transactions;

  if (!item) return null;

  const isLow = item.quantity <= item.threshold;

  const zoomIn = () => setZoom((z) => Math.min(16, +(z * 1.5).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(1, +(z / 1.5).toFixed(2)));
  const zoomReset = () => setZoom(1);

  const TabBtn = ({ id, label, count }: { id: TxTab; label: string; count: number }) => (
    <button
      onClick={() => setTxTab(id)}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
        txTab === id
          ? "bg-card text-foreground shadow-sm border border-border"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label} <span className="opacity-60">({count})</span>
    </button>
  );

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
            <div className="flex items-center justify-between mb-2 gap-2">
              <h4 className="text-sm font-semibold text-foreground">Stock History</h4>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-muted-foreground mr-1">
                  {zoom > 1 ? `Last ${zoomedHistory.length} of ${history.length}` : `${history.length} points`}
                </span>
                <button
                  onClick={zoomOut}
                  disabled={zoom <= 1}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Zoom out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={zoomIn}
                  disabled={zoomedHistory.length <= 2}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Zoom in"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  onClick={zoomReset}
                  disabled={zoom === 1}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Reset zoom"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="h-56">
              {history.length < 2 ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  Not enough history yet to plot a trend.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={zoomedHistory} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} hide={zoomedHistory.length > 8} />
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
            <div className="p-4 pb-2 flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Transactions</h4>
                <p className="text-xs text-muted-foreground">Most recent first</p>
              </div>
              <div className="inline-flex items-center p-1 rounded-full bg-secondary border border-border">
                <TabBtn id="all" label="All" count={transactions.length} />
                <TabBtn id="restock" label="Restock" count={restockTx.length} />
                <TabBtn id="consume" label="Consumed" count={consumeTx.length} />
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {visibleTx.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {txTab === "restock"
                    ? "No restock transactions recorded."
                    : txTab === "consume"
                    ? "No consumption transactions recorded."
                    : "No transactions recorded."}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-secondary border-y border-border sticky top-0">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-4 py-2 font-medium">When</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="px-4 py-2 font-medium">Source</th>
                      <th className="px-4 py-2 font-medium text-right">Δ</th>
                      <th className="px-4 py-2 font-medium text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTx.map((t) => {
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
