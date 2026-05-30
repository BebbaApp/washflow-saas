import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInventory } from "@/hooks/useInventory";

interface PendingOrder {
  id: string;
  service: string;
  orderNumber: string;
  customer: string;
  vehicle?: string;
}

interface Props {
  order: PendingOrder | null;
  onCancel: () => void;
  onConfirmed: () => void;
}

const NOTE_MAX = 160;

interface Row {
  itemId: string;
  itemName: string;
  unit: string;
  needed: number;
  available: number;
  after: number;
  negative: boolean;
  source: "service" | "vehicle" | "extra";
}

interface Extra {
  uid: string;
  itemId: string;
  qty: string; // string for input control
  note: string;
}

export const CompleteWashDialog = ({ order, onCancel, onConfirmed }: Props) => {
  const { items, previewConsumption, confirmConsumption, previewVehicleConsumption, consumeForWash } = useInventory();
  const [overrideNote, setOverrideNote] = useState("");
  const [extras, setExtras] = useState<Extra[]>([]);

  useEffect(() => {
    if (order) { setOverrideNote(""); setExtras([]); }
  }, [order]);

  const merged: Row[] = useMemo(() => {
    if (!order) return [];
    const map = new Map<string, Row>();
    const serviceRows = previewConsumption(order.service);
    for (const r of serviceRows) {
      if (!r.item) continue;
      map.set(r.itemId, {
        itemId: r.itemId,
        itemName: r.item.name,
        unit: r.item.unit,
        needed: r.qty,
        available: r.item.quantity,
        after: r.after,
        negative: r.negative,
        source: "service",
      });
    }
    const vehicleRows = order.vehicle ? previewVehicleConsumption(order.vehicle) : [];
    for (const r of vehicleRows) {
      if (!r.mapped || !r.item || !r.itemId) continue;
      const existing = map.get(r.itemId);
      if (existing) {
        existing.needed = +(existing.needed + r.qty).toFixed(3);
        existing.after = +(existing.available - existing.needed).toFixed(3);
        existing.negative = existing.after < 0;
      } else {
        map.set(r.itemId, {
          itemId: r.itemId,
          itemName: r.item.name,
          unit: r.item.unit,
          needed: r.qty,
          available: r.item.quantity,
          after: r.after,
          negative: r.negative,
          source: "vehicle",
        });
      }
    }
    for (const e of extras) {
      const item = items.find((i) => i.id === e.itemId);
      const qty = parseFloat(e.qty);
      if (!item || !qty || qty <= 0) continue;
      const existing = map.get(item.id);
      if (existing) {
        existing.needed = +(existing.needed + qty).toFixed(3);
        existing.after = +(existing.available - existing.needed).toFixed(3);
        existing.negative = existing.after < 0;
      } else {
        const after = item.quantity - qty;
        map.set(item.id, {
          itemId: item.id,
          itemName: item.name,
          unit: item.unit,
          needed: qty,
          available: item.quantity,
          after,
          negative: after < 0,
          source: "extra",
        });
      }
    }
    return Array.from(map.values());
  }, [order, previewConsumption, previewVehicleConsumption, extras, items]);

  if (!order) return null;

  const negativeRows = merged.filter((r) => r.negative);
  const hasNegative = negativeRows.length > 0;
  const noteValid = overrideNote.length <= NOTE_MAX;

  const addExtra = () => setExtras((prev) => [...prev, { uid: crypto.randomUUID(), itemId: "", qty: "", note: "" }]);
  const updateExtra = (uid: string, patch: Partial<Extra>) =>
    setExtras((prev) => prev.map((e) => (e.uid === uid ? { ...e, ...patch } : e)));
  const removeExtra = (uid: string) => setExtras((prev) => prev.filter((e) => e.uid !== uid));

  const handleConfirm = async (override: boolean) => {
    if (!noteValid) return;
    const opts = { override, overrideNote: override ? overrideNote.trim() : undefined };
    const a = await confirmConsumption(order, opts);
    if (!a.ok) return;
    const validExtras = extras
      .map((e) => ({ itemId: e.itemId, qty: parseFloat(e.qty), note: e.note.trim() }))
      .filter((e) => e.itemId && e.qty > 0);
    if (order.vehicle || validExtras.length > 0) {
      await consumeForWash(
        {
          orderId: order.id,
          orderNumber: order.orderNumber,
          vehicleInput: order.vehicle ?? "",
          extras: validExtras,
        },
        opts,
      );
    }
    onConfirmed();
  };

  return (
    <Dialog open={!!order} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="bg-card border-border text-foreground sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Start wash · {order.orderNumber}</DialogTitle>
          <DialogDescription>
            {merged.length === 0
              ? `No inventory mapping configured for "${order.service}"${order.vehicle ? ` or "${order.vehicle}"` : ""}. Add extra products below if needed.`
              : `Stock that will be deducted now to start ${order.customer}'s ${order.service}${order.vehicle ? ` (${order.vehicle})` : ""}.`}
          </DialogDescription>
        </DialogHeader>

        {merged.length > 0 && (() => {
          const worst = merged.reduce((acc, r) => (r.after < acc.after ? r : acc), merged[0]);
          return (
            <div className="rounded-lg border border-border bg-secondary/40 overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border">
                <span>Item</span>
                <span className="text-right">Needed</span>
                <span className="text-right">Available</span>
                <span className="text-right">After</span>
              </div>
              <ul>
                {merged.map((r) => {
                  const tone = r.negative ? "text-destructive" : "text-success";
                  return (
                    <li
                      key={r.itemId}
                      className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-3 py-2 text-xs border-b border-border last:border-b-0"
                    >
                      <span className="text-foreground truncate">
                        {r.itemName}
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {r.source}
                        </span>
                      </span>
                      <span className="font-mono text-foreground text-right">{r.needed} {r.unit}</span>
                      <span className="font-mono text-muted-foreground text-right">{r.available} {r.unit}</span>
                      <span className={`font-mono text-right ${tone}`}>
                        {r.after} {r.unit}{r.negative && " ⚠"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="px-3 py-2 text-xs flex items-center justify-between bg-secondary/40 border-t border-border">
                <span className="text-muted-foreground">Worst projected balance</span>
                <span className={`font-mono font-semibold ${worst.negative ? "text-destructive" : "text-success"}`}>
                  {worst.itemName}: {worst.after} {worst.unit}
                </span>
              </div>
            </div>
          );
        })()}

        {/* Extras */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-secondary-foreground">Additional products</Label>
            <button
              type="button"
              onClick={addExtra}
              className="inline-flex items-center gap-1 text-xs text-primary hover:opacity-80"
            >
              <Plus className="w-3.5 h-3.5" /> Add product
            </button>
          </div>
          {extras.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic">
              Add ad-hoc items used on this wash (e.g. extra wax, special dressing).
            </p>
          ) : (
            <ul className="space-y-2">
              {extras.map((e) => {
                const item = items.find((i) => i.id === e.itemId);
                return (
                  <li key={e.uid} className="grid grid-cols-[1fr_5rem_auto] gap-2 items-center">
                    <Select value={e.itemId || "none"} onValueChange={(v) => updateExtra(e.uid, { itemId: v === "none" ? "" : v })}>
                      <SelectTrigger className="bg-secondary border-border text-foreground h-9 text-xs">
                        <SelectValue placeholder="Pick item" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Pick item —</SelectItem>
                        {items.map((i) => (
                          <SelectItem key={i.id} value={i.id}>{i.name} ({i.quantity} {i.unit})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="relative">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={e.qty}
                        onChange={(ev) => updateExtra(e.uid, { qty: ev.target.value })}
                        placeholder="Qty"
                        className="bg-secondary border-border text-foreground h-9 text-xs pr-8"
                      />
                      {item && (
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{item.unit}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeExtra(e.uid)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {hasNegative && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-2">
            <div className="flex items-start gap-2 text-xs text-destructive">
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Insufficient stock for {negativeRows.length} item
                {negativeRows.length === 1 ? "" : "s"}: {negativeRows.map((r) => r.itemName).join(", ")}.
              </span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-secondary-foreground">Override reason</Label>
                <span className={`text-[10px] font-mono ${noteValid ? "text-muted-foreground" : "text-destructive"}`}>
                  {overrideNote.length}/{NOTE_MAX}
                </span>
              </div>
              <Input
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
                placeholder="Required: explain why you're proceeding"
                maxLength={NOTE_MAX}
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            Cancel
          </button>
          {hasNegative ? (
            <button
              type="button"
              onClick={() => handleConfirm(true)}
              disabled={!overrideNote.trim() || !noteValid}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-destructive text-destructive-foreground font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <AlertTriangle className="w-4 h-4" />
              Proceed Anyway
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleConfirm(false)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-success text-success-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              <CheckCircle2 className="w-4 h-4" />
              Confirm & Complete
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
