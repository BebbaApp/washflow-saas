import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useInventory, type InventoryItem } from "@/hooks/useInventory";
import { useSuppliers } from "@/hooks/useSuppliers";
import { useCurrency } from "@/hooks/useCurrency";

interface Props {
  item: InventoryItem | null;
  onOpenChange: (open: boolean) => void;
}

export function ReorderDialog({ item, onOpenChange }: Props) {
  const { reorderItem, transactions } = useInventory();
  const { suppliers } = useSuppliers();
  const { formatPrice } = useCurrency();

  // Prefill: last restock tx of this item, falling back to item itself.
  const lastRestock = item
    ? transactions.find((t) => t.itemId === item.id && t.type === "restock" && t.delta > 0)
    : null;

  const [qty, setQty] = useState(() =>
    lastRestock ? String(lastRestock.delta) : item ? String(Math.max(1, item.recommendedMax ?? item.threshold ?? 1)) : "1"
  );
  const [unitCost, setUnitCost] = useState(() =>
    item ? String(item.unitCost ?? 0) : "0"
  );
  const [supplierId, setSupplierId] = useState<string>(() => item?.supplierId ?? "__none");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset form when item changes
  const itemKey = item?.id ?? "";
  const [lastKey, setLastKey] = useState(itemKey);
  if (itemKey !== lastKey) {
    setLastKey(itemKey);
    if (item) {
      setQty(lastRestock ? String(lastRestock.delta) : String(Math.max(1, item.recommendedMax ?? item.threshold ?? 1)));
      setUnitCost(String(item.unitCost ?? 0));
      setSupplierId(item.supplierId ?? "__none");
      setNotes("");
    }
  }

  if (!item) return null;

  const q = Number(qty);
  const c = Number(unitCost);
  const total = +(q * c).toFixed(2);
  const error =
    !Number.isFinite(q) || q <= 0 ? "Quantity must be > 0" :
    !Number.isFinite(c) || c < 0 ? "Unit cost must be ≥ 0" :
    null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (error) return;
    setBusy(true);
    const res = await reorderItem({
      itemId: item.id,
      quantity: q,
      unitCost: c,
      supplierId: supplierId === "__none" ? null : supplierId,
      notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Reordered ${q}${item.unit ? ` ${item.unit}` : ""} of ${item.name}` + (c > 0 ? ` · expense ${formatPrice(total)}` : ""));
      onOpenChange(false);
    } else {
      toast.error(res.reason ?? "Reorder failed");
    }
  };

  const ps = item.packSize && item.packSize > 0 ? item.packSize : 1;
  const unitLabel = item.unit ? ` ${item.unit}` : "";
  const fmtQty = (n: number) => (ps > 1 && item.unit ? `${n} × ${ps}${item.unit}` : `${n}${unitLabel}`);

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reorder · {item.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 mt-2">
          <p className="text-xs text-muted-foreground">
            Current stock: <span className="font-mono text-foreground">{fmtQty(item.quantity)}</span>
            {lastRestock && (
              <> · last restock: <span className="font-mono">{fmtQty(lastRestock.delta)}</span> @ <span className="font-mono">{lastRestock.unitCost != null ? formatPrice(lastRestock.unitCost) : "?"}</span></>
            )}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-sm">Quantity{item.unit ? ` (${item.unit})` : ""}</Label>
              <Input type="number" min="0" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} className="bg-secondary border-border" autoFocus />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Unit cost</Label>
              <Input type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="bg-secondary border-border" />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Supplier</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="bg-secondary border-border">
                <SelectValue placeholder="No supplier" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="__none">— No supplier —</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {suppliers.length === 0 && (
              <p className="text-[11px] text-muted-foreground">Add suppliers in Settings → Workspace.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. PO #4521" maxLength={120} className="bg-secondary border-border" />
          </div>

          <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">New balance</span>
              <span className="font-mono text-success">{item.quantity + (Number.isFinite(q) ? q : 0)}{item.unit ? ` ${item.unit}` : ""}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expense to log</span>
              <span className="font-mono text-foreground">{total > 0 ? `$${total}` : "—"}</span>
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => onOpenChange(false)} className="flex-1 py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-sm hover:opacity-90">
              Cancel
            </button>
            <button type="submit" disabled={!!error || busy} className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 disabled:opacity-50">
              {busy ? "Reordering..." : "Confirm Reorder"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
