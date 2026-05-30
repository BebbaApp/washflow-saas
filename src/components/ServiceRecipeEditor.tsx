import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useInventory } from "@/hooks/useInventory";

interface Line {
  itemId: string;
  qty: number;
}

interface Props {
  /** Existing recipe lines for this service. */
  value: Line[];
  onChange: (lines: Line[]) => void;
}

/**
 * Per-service inventory toggle list. Every inventory item appears with a
 * switch + quantity input. Toggling on adds the item to the service recipe
 * so it auto-deducts when the wash starts.
 */
export const ServiceRecipeEditor = ({ value, onChange }: Props) => {
  const { items } = useInventory();

  const byId = useMemo(() => {
    const map = new Map<string, number>();
    value.forEach((l) => map.set(l.itemId, l.qty));
    return map;
  }, [value]);

  const toggle = (itemId: string, enabled: boolean) => {
    if (enabled) {
      onChange([...value, { itemId, qty: 0 }]);
    } else {
      onChange(value.filter((l) => l.itemId !== itemId));
    }
  };

  const setQty = (itemId: string, qty: number) => {
    onChange(value.map((l) => (l.itemId === itemId ? { ...l, qty } : l)));
  };

  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No inventory items yet — add items in the Inventory tab to enable per-service auto-deduct.
      </p>
    );
  }

  return (
    <div className="space-y-1.5 max-h-64 overflow-y-auto rounded-lg border border-border bg-secondary/40 p-2">
      {items.map((it) => {
        const enabled = byId.has(it.id);
        const qty = byId.get(it.id) ?? 0;
        return (
          <div
            key={it.id}
            className="grid grid-cols-[auto_1fr_5.5rem_auto] gap-2 items-center px-1.5 py-1 rounded-md hover:bg-secondary/60"
          >
            <Switch
              checked={enabled}
              onCheckedChange={(v) => toggle(it.id, v)}
              aria-label={`Use ${it.name} for this service`}
            />
            <Label className="text-xs text-foreground truncate cursor-pointer" onClick={() => toggle(it.id, !enabled)}>
              {it.name}
            </Label>
            <Input
              type="number"
              min={0}
              step="any"
              disabled={!enabled}
              value={enabled ? qty || "" : ""}
              onChange={(e) => setQty(it.id, parseFloat(e.target.value) || 0)}
              placeholder="Qty"
              className="h-8 text-xs bg-background border-border text-foreground"
            />
            <span className="text-[10px] text-muted-foreground w-8 text-right">{it.unit}</span>
          </div>
        );
      })}
    </div>
  );
};
