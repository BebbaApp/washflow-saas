import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useInventory } from "@/hooks/useInventory";
import { CONCENTRATES } from "@/lib/vehicleUsage";

interface Line {
  itemId: string;
  qty: number;
}

interface Props {
  /** Existing extra recipe lines for this service. */
  value: Line[];
  onChange: (lines: Line[]) => void;
}

/**
 * Per-service inventory editor.
 *
 * The Usage Guide is the single source of truth for vehicle-scaled
 * measurements (chemicals + water). Items already mapped there appear
 * here as read-only "Auto (Usage Guide)" entries and are deducted
 * automatically based on vehicle type.
 *
 * The recipe below only configures **extras** — fixed quantities added
 * on top of the Usage Guide deduction (e.g. wax pad, microfibre cloth)
 * that don't scale with vehicle size.
 */
export const ServiceRecipeEditor = ({ value, onChange }: Props) => {
  const { items, vehicleMap, waterItemId } = useInventory();

  // itemIds already covered by the Usage Guide
  const mapped = useMemo(() => {
    const map = new Map<string, string>(); // itemId -> source label
    for (const c of CONCENTRATES) {
      const id = vehicleMap[c.key];
      if (id) map.set(id, c.name);
    }
    if (waterItemId) map.set(waterItemId, "Water (per-vehicle)");
    return map;
  }, [vehicleMap, waterItemId]);

  const byId = useMemo(() => {
    const m = new Map<string, number>();
    value.forEach((l) => m.set(l.itemId, l.qty));
    return m;
  }, [value]);

  const toggle = (itemId: string, enabled: boolean) => {
    if (enabled) onChange([...value, { itemId, qty: 0 }]);
    else onChange(value.filter((l) => l.itemId !== itemId));
  };

  const setQty = (itemId: string, qty: number) => {
    onChange(value.map((l) => (l.itemId === itemId ? { ...l, qty } : l)));
  };

  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No inventory added yet.
      </p>
    );
  }

  const mappedItems = items.filter((it) => mapped.has(it.id));
  const extraItems = items.filter((it) => !mapped.has(it.id));

  return (
    <div className="space-y-2">
      {/* Usage Guide auto-deduct (read-only) */}
      {mappedItems.length > 0 && (
        <div className="rounded-lg border border-border bg-secondary/40 p-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-1.5 pb-1">
            From Usage Guide · auto-scaled by vehicle
          </p>
          <div className="space-y-1">
            {mappedItems.map((it) => (
              <div
                key={it.id}
                className="grid grid-cols-[1fr_auto] gap-2 items-center px-1.5 py-1 rounded-md"
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-xs text-foreground truncate">{it.name}</span>
                  <span className="text-[10px] text-muted-foreground truncate">
                    {mapped.get(it.id)}
                  </span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                  Auto
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Extras (toggleable) */}
      <div className="rounded-lg border border-border bg-secondary/40 p-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-1.5 pb-1">
          Extras · fixed qty added on top
        </p>
        {extraItems.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-1.5 py-1">
            All inventory items are mapped in the Usage Guide.
          </p>
        ) : (
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {extraItems.map((it) => {
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
                    aria-label={`Add ${it.name} as extra`}
                  />
                  <Label
                    className="text-xs text-foreground truncate cursor-pointer"
                    onClick={() => toggle(it.id, !enabled)}
                  >
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
                  <span className="text-[10px] text-muted-foreground w-8 text-right">
                    {it.unit}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
