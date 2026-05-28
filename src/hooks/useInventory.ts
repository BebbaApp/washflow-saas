import { useEffect, useState, useCallback } from "react";
import { CONCENTRATES, WATER, matchVehicle } from "@/lib/vehicleUsage";
import { convertUnits, canConvert } from "@/lib/unitConversions";

export const INVENTORY_CATEGORIES = ["Soap", "Wax", "Towels", "Chemicals", "Tools", "Other"] as const;
/** Categories are admin-configurable per tenant (see useInventoryCategories);
 *  the built-in list above is only a fallback when no rows exist. */
export type InventoryCategory = string;

export interface InventoryItem {
  id: string;
  name: string;
  category: InventoryCategory;
  quantity: number;
  unit: string;
  threshold: number;
  /** Optional preset id (see src/lib/inventoryPresets.ts) for typed products. */
  presetId?: string;
  /** Optional descriptive subtype, e.g. "High-foam shampoo". */
  subtype?: string;
  /** Optional recommended minimum stock to keep on hand. */
  recommendedMin?: number;
  /** Optional recommended maximum stock for a typical operation. */
  recommendedMax?: number;
}

export type InventoryFlow = "confirmed" | "auto" | "override" | "manual" | "undo";

export interface InventoryTransaction {
  id: string;
  itemId: string;
  itemName: string;
  delta: number;          // negative = consumption, positive = restock/adjustment up
  balance: number;        // resulting quantity
  type: "restock" | "consume" | "adjust";
  source: string;         // e.g. "Manual", "Order W-001"
  notes?: string;
  flow?: InventoryFlow;   // origin of the change (preview/confirmation vs auto fallback)
  createdAt: string;
}

// Map service name -> list of {itemId, qty consumed per wash}
export type RecipeMap = Record<string, { itemId: string; qty: number }[]>;

const ITEMS_KEY = "aquawash.inventory.items.v1";
const TX_KEY = "aquawash.inventory.transactions.v1";
const RECIPE_KEY = "aquawash.inventory.recipes.v1";
const PROCESSED_KEY = "aquawash.inventory.processedOrders.v1";
// Mapping from concentrate key (see vehicleUsage.ts) -> inventory item id.
const VEHICLE_MAP_KEY = "aquawash.inventory.vehicleMap.v1";
// Optional inventory item id used to deduct water (e.g. a "Water" stock line in L).
const WATER_ITEM_KEY = "aquawash.inventory.waterItem.v1";
// Idempotency keys for vehicle-based deductions.
const VEHICLE_PROCESSED_KEY = "aquawash.inventory.vehicleProcessed.v1";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// ---- Singleton store (module-scoped) so every consumer sees the same data ----
let _items: InventoryItem[] = load(ITEMS_KEY, [] as InventoryItem[]);
let _tx: InventoryTransaction[] = load(TX_KEY, [] as InventoryTransaction[]);
let _recipes: RecipeMap = load(RECIPE_KEY, {} as RecipeMap);
let _processed: Set<string> = new Set(load<string[]>(PROCESSED_KEY, []));
let _vehicleMap: Record<string, string> = load(VEHICLE_MAP_KEY, {} as Record<string, string>);
let _waterItemId: string | null = load<string | null>(WATER_ITEM_KEY, null);
let _vehicleProcessed: Set<string> = new Set(load<string[]>(VEHICLE_PROCESSED_KEY, []));

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

function persistItems() {
  localStorage.setItem(ITEMS_KEY, JSON.stringify(_items));
}
function persistTx() {
  // Cap log at 1000 most recent entries
  if (_tx.length > 1000) _tx = _tx.slice(0, 1000);
  localStorage.setItem(TX_KEY, JSON.stringify(_tx));
}
function persistRecipes() {
  localStorage.setItem(RECIPE_KEY, JSON.stringify(_recipes));
}
function persistProcessed() {
  localStorage.setItem(PROCESSED_KEY, JSON.stringify(Array.from(_processed)));
}
function persistVehicleMap() {
  localStorage.setItem(VEHICLE_MAP_KEY, JSON.stringify(_vehicleMap));
}
function persistWaterItem() {
  localStorage.setItem(WATER_ITEM_KEY, JSON.stringify(_waterItemId));
}
function persistVehicleProcessed() {
  localStorage.setItem(VEHICLE_PROCESSED_KEY, JSON.stringify(Array.from(_vehicleProcessed)));
}

/** Convert mL of neat product to whatever unit the inventory item is stored in. */
function mlToItemUnit(mL: number, itemUnit: string): number {
  if (canConvert("mL", itemUnit)) {
    const v = convertUnits(mL, "mL", itemUnit);
    return v ?? mL;
  }
  // No conversion possible (e.g. pcs) — keep raw value as a reasonable fallback.
  return mL;
}
function lToItemUnit(L: number, itemUnit: string): number {
  if (canConvert("L", itemUnit)) {
    const v = convertUnits(L, "L", itemUnit);
    return v ?? L;
  }
  return L;
}


function logTx(entry: Omit<InventoryTransaction, "id" | "createdAt">) {
  const tx: InventoryTransaction = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  _tx = [tx, ..._tx];
  persistTx();
}

function applyDelta(itemId: string, delta: number): InventoryItem | null {
  const idx = _items.findIndex((i) => i.id === itemId);
  if (idx === -1) return null;
  const next = { ..._items[idx], quantity: Math.max(0, _items[idx].quantity + delta) };
  _items = [..._items.slice(0, idx), next, ..._items.slice(idx + 1)];
  persistItems();
  return next;
}

export function useInventory() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  const addItem = useCallback((data: Omit<InventoryItem, "id">) => {
    const item: InventoryItem = { ...data, id: crypto.randomUUID() };
    _items = [..._items, item];
    persistItems();
    if (item.quantity > 0) {
      logTx({
        itemId: item.id,
        itemName: item.name,
        delta: item.quantity,
        balance: item.quantity,
        type: "restock",
        source: "Initial stock",
        flow: "manual",
      });
    }
    notify();
    return item;
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<Omit<InventoryItem, "id">>) => {
    const prev = _items.find((i) => i.id === id);
    if (!prev) return;
    const next = { ...prev, ...patch };
    _items = _items.map((i) => (i.id === id ? next : i));
    persistItems();
    if (patch.quantity !== undefined && patch.quantity !== prev.quantity) {
      const delta = patch.quantity - prev.quantity;
      logTx({
        itemId: id,
        itemName: next.name,
        delta,
        balance: next.quantity,
        type: "adjust",
        source: "Manual edit",
        flow: "manual",
      });
    }
    notify();
  }, []);

  const deleteItem = useCallback((id: string) => {
    _items = _items.filter((i) => i.id !== id);
    persistItems();
    notify();
  }, []);

  const adjustStock = useCallback((itemId: string, delta: number, notes?: string, source = "Manual") => {
    const updated = applyDelta(itemId, delta);
    if (!updated) return;
    logTx({
      itemId,
      itemName: updated.name,
      delta,
      balance: updated.quantity,
      type: delta >= 0 ? "restock" : "consume",
      source,
      notes,
      flow: "manual",
    });
    notify();
  }, []);

  const setRecipe = useCallback((serviceName: string, lines: { itemId: string; qty: number }[]) => {
    const cleaned = lines.filter((l) => l.itemId && l.qty > 0);
    if (cleaned.length === 0) {
      delete _recipes[serviceName];
    } else {
      _recipes = { ..._recipes, [serviceName]: cleaned };
    }
    persistRecipes();
    notify();
  }, []);

  // Preview deductions for a given service against current stock.
  const previewConsumption = useCallback((serviceName: string) => {
    const recipe = _recipes[serviceName] ?? [];
    return recipe.map((line) => {
      const item = _items.find((i) => i.id === line.itemId);
      const after = item ? item.quantity - line.qty : 0;
      return {
        itemId: line.itemId,
        qty: line.qty,
        item,
        after,
        negative: !!item && after < 0,
      };
    });
  }, []);

  // Apply deductions for a single order. Idempotent. Optionally overrides
  // the negative-stock guard and records the override note on each tx.
  const confirmConsumption = useCallback(
    (
      order: { id: string; service: string; orderNumber: string },
      opts: { override?: boolean; overrideNote?: string } = {}
    ): { ok: boolean; negativeItems: string[] } => {
      if (_processed.has(order.id)) return { ok: true, negativeItems: [] };
      const recipe = _recipes[order.service] ?? [];
      const negativeItems: string[] = [];
      for (const line of recipe) {
        const item = _items.find((i) => i.id === line.itemId);
        if (item && item.quantity - line.qty < 0) negativeItems.push(item.name);
      }
      if (negativeItems.length > 0 && !opts.override) {
        return { ok: false, negativeItems };
      }
      _processed.add(order.id);
      for (const line of recipe) {
        const updated = applyDelta(line.itemId, -line.qty);
        if (!updated) continue;
        const baseNote = order.service;
        const note = opts.override && opts.overrideNote
          ? `${baseNote} · Override: ${opts.overrideNote}`
          : opts.override
            ? `${baseNote} · Override (negative stock)`
            : baseNote;
        logTx({
          itemId: line.itemId,
          itemName: updated.name,
          delta: -line.qty,
          balance: updated.quantity,
          type: "consume",
          source: `Order ${order.orderNumber}`,
          notes: note,
          flow: opts.override ? "override" : "confirmed",
        });
      }
      persistProcessed();
      notify();
      return { ok: true, negativeItems: [] };
    },
    []
  );

  // Reverse the most recent transaction (restock or auto-deduction).
  const undoLastTransaction = useCallback((): { ok: boolean; reason?: string } => {
    const last = _tx[0];
    if (!last) return { ok: false, reason: "No transactions to undo" };
    if (last.flow === "undo") {
      return { ok: false, reason: "Last entry is already an undo" };
    }
    const updated = applyDelta(last.itemId, -last.delta);
    if (!updated) return { ok: false, reason: "Item no longer exists" };
    logTx({
      itemId: last.itemId,
      itemName: updated.name,
      delta: -last.delta,
      balance: updated.quantity,
      type: "adjust",
      source: "Undo",
      notes: `Undo of ${last.source}${last.notes ? ` (${last.notes})` : ""}`,
      flow: "undo",
    });
    notify();
    return { ok: true };
  }, []);

  // ----- Vehicle-based usage -----

  const setVehicleMapping = useCallback((concentrateKey: string, itemId: string | null) => {
    if (itemId) _vehicleMap = { ..._vehicleMap, [concentrateKey]: itemId };
    else { const { [concentrateKey]: _drop, ...rest } = _vehicleMap; _vehicleMap = rest; }
    persistVehicleMap();
    notify();
  }, []);

  const setWaterItem = useCallback((itemId: string | null) => {
    _waterItemId = itemId;
    persistWaterItem();
    notify();
  }, []);

  /** Compute the inventory rows that would be deducted for one wash of `vehicle`. */
  const previewVehicleConsumption = useCallback((vehicleInput: string) => {
    const vehicle = matchVehicle(vehicleInput);
    if (!vehicle) return [] as Array<{
      key: string; name: string; itemId: string | null; item: InventoryItem | undefined;
      qty: number; qtyUnit: string; after: number; negative: boolean; mapped: boolean;
    }>;
    const rows = CONCENTRATES.map((row) => {
      const itemId = _vehicleMap[row.key] ?? null;
      const item = itemId ? _items.find((i) => i.id === itemId) : undefined;
      const mL = row.values[vehicle];
      const qty = item ? mlToItemUnit(mL, item.unit) : mL;
      const qtyUnit = item?.unit ?? row.unit;
      const after = item ? item.quantity - qty : 0;
      return {
        key: row.key, name: row.name, itemId, item, qty: +qty.toFixed(3), qtyUnit,
        after: +after.toFixed(3), negative: !!item && after < 0, mapped: !!item,
      };
    });
    if (_waterItemId) {
      const item = _items.find((i) => i.id === _waterItemId);
      const totalL = WATER.find((w) => w.key === "total_water")!.values[vehicle];
      const qty = item ? lToItemUnit(totalL, item.unit) : totalL;
      const qtyUnit = item?.unit ?? "L";
      const after = item ? item.quantity - qty : 0;
      rows.push({
        key: "total_water", name: "Total water per wash",
        itemId: _waterItemId, item, qty: +qty.toFixed(3), qtyUnit,
        after: +after.toFixed(3), negative: !!item && after < 0, mapped: !!item,
      });
    }
    return rows;
  }, []);

  /** Deduct stock for a vehicle wash. Idempotent when `orderId` is provided.
   *  `extras` are additional ad-hoc lines (e.g. wax for a special) that should
   *  be deducted as part of the same job. They are merged with the vehicle map. */
  const consumeForWash = useCallback(
    (
      args: {
        orderId?: string;
        orderNumber?: string;
        vehicleInput: string;
        source?: string;
        extras?: { itemId: string; qty: number; note?: string }[];
      },
      opts: { override?: boolean; overrideNote?: string } = {}
    ): { ok: boolean; negativeItems: string[] } => {
      const vehicle = matchVehicle(args.vehicleInput);
      const idemKey = args.orderId ? `wash:${args.orderId}` : null;
      if (idemKey && _vehicleProcessed.has(idemKey)) return { ok: true, negativeItems: [] };

      const baseRows = vehicle
        ? previewVehicleConsumption(args.vehicleInput).filter((r) => r.mapped && r.item)
        : [];
      // Build extras with current item / projected balance so we can validate.
      const extraRows = (args.extras ?? [])
        .filter((e) => e.itemId && e.qty > 0)
        .map((e) => {
          const item = _items.find((i) => i.id === e.itemId);
          const after = item ? item.quantity - e.qty : 0;
          return {
            itemId: e.itemId, item, qty: e.qty,
            after, negative: !!item && after < 0, note: e.note,
          };
        })
        .filter((r) => r.item);

      if (baseRows.length === 0 && extraRows.length === 0) {
        return { ok: true, negativeItems: [] };
      }

      const negativeItems = [
        ...baseRows.filter((r) => r.negative).map((r) => r.item!.name),
        ...extraRows.filter((r) => r.negative).map((r) => r.item!.name),
      ];
      if (negativeItems.length > 0 && !opts.override) {
        return { ok: false, negativeItems };
      }
      if (idemKey) { _vehicleProcessed.add(idemKey); persistVehicleProcessed(); }
      const source = args.source ?? (args.orderNumber ? `Order ${args.orderNumber}` : "Wash");

      for (const r of baseRows) {
        const updated = applyDelta(r.itemId!, -r.qty);
        if (!updated) continue;
        const baseNote = `${vehicle} wash`;
        const note = opts.override
          ? `${baseNote} · Override${opts.overrideNote ? `: ${opts.overrideNote}` : " (negative stock)"}`
          : baseNote;
        logTx({
          itemId: r.itemId!,
          itemName: updated.name,
          delta: -r.qty,
          balance: updated.quantity,
          type: "consume",
          source,
          notes: note,
          flow: opts.override ? "override" : "auto",
        });
      }
      for (const r of extraRows) {
        const updated = applyDelta(r.itemId, -r.qty);
        if (!updated) continue;
        const baseNote = `Extra${vehicle ? ` (${vehicle})` : ""}${r.note ? `: ${r.note}` : ""}`;
        const note = opts.override
          ? `${baseNote} · Override${opts.overrideNote ? `: ${opts.overrideNote}` : ""}`
          : baseNote;
        logTx({
          itemId: r.itemId,
          itemName: updated.name,
          delta: -r.qty,
          balance: updated.quantity,
          type: "consume",
          source,
          notes: note,
          flow: opts.override ? "override" : "manual",
        });
      }
      notify();
      return { ok: true, negativeItems: [] };
    },
    [previewVehicleConsumption]
  );


  // Process newly-completed orders. Idempotent thanks to processed-set.
  // NOTE: this is a fallback path; UI should prefer confirmConsumption so the
  // user gets a preview/override step before status flips to "completed".
  const processCompletedOrders = useCallback(
    (orders: { id: string; service: string; orderNumber: string; status: string; vehicle?: string }[]) => {
      let changed = false;
      for (const o of orders) {
        if (o.status !== "completed") continue;
        // Vehicle-based fallback (independent of service recipe). Idempotent per-order.
        if (o.vehicle) {
          const idemKey = `wash:${o.id}`;
          if (!_vehicleProcessed.has(idemKey)) {
            const rows = previewVehicleConsumption(o.vehicle).filter((r) => r.mapped && r.item);
            if (rows.length > 0 && !rows.some((r) => r.negative)) {
              _vehicleProcessed.add(idemKey);
              changed = true;
              for (const r of rows) {
                const updated = applyDelta(r.itemId!, -r.qty);
                if (!updated) continue;
                logTx({
                  itemId: r.itemId!,
                  itemName: updated.name,
                  delta: -r.qty,
                  balance: updated.quantity,
                  type: "consume",
                  source: `Order ${o.orderNumber}`,
                  notes: `${matchVehicle(o.vehicle) ?? o.vehicle} wash`,
                  flow: "auto",
                });
              }
            }
          }
        }
        // Service-recipe path (legacy).
        if (_processed.has(o.id)) continue;
        _processed.add(o.id);
        changed = true;
        const recipe = _recipes[o.service];
        if (!recipe || recipe.length === 0) continue;
        for (const line of recipe) {
          const updated = applyDelta(line.itemId, -line.qty);
          if (!updated) continue;
          logTx({
            itemId: line.itemId,
            itemName: updated.name,
            delta: -line.qty,
            balance: updated.quantity,
            type: "consume",
            source: `Order ${o.orderNumber}`,
            notes: o.service,
            flow: "auto",
          });
        }
      }
      if (changed) {
        persistProcessed();
        persistVehicleProcessed();
        notify();
      }
    },
    [previewVehicleConsumption]
  );

  return {
    items: _items,
    transactions: _tx,
    recipes: _recipes,
    vehicleMap: _vehicleMap,
    waterItemId: _waterItemId,
    addItem,
    updateItem,
    deleteItem,
    adjustStock,
    setRecipe,
    previewConsumption,
    confirmConsumption,
    undoLastTransaction,
    processCompletedOrders,
    setVehicleMapping,
    setWaterItem,
    previewVehicleConsumption,
    consumeForWash,
  };
}
