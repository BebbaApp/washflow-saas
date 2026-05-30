import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useAuth } from "@/hooks/useAuth";
import { CONCENTRATES, WATER, matchVehicle } from "@/lib/vehicleUsage";
import { convertUnits, canConvert } from "@/lib/unitConversions";

export const INVENTORY_CATEGORIES = ["Soap", "Wax", "Towels", "Chemicals", "Tools", "Other"] as const;
export type InventoryCategory = string;

export interface InventoryItem {
  id: string;
  name: string;
  category: InventoryCategory;
  quantity: number;
  unit: string;
  threshold: number;
  presetId?: string;
  subtype?: string;
  recommendedMin?: number;
  recommendedMax?: number;
  /** Unit cost used to auto-log expenses on capture / restock. */
  unitCost: number;
  /** Override the inventory-category default expense category. */
  expenseCategory?: string;
  /** Supplier reference. */
  supplierId?: string;
  /** Pack size — how much each counted unit contains (e.g. 5 for a 5L bottle). */
  packSize?: number;
}

export type InventoryFlow = "confirmed" | "auto" | "override" | "manual" | "undo";

export interface InventoryTransaction {
  id: string;
  itemId: string;
  itemName: string;
  delta: number;
  balance: number;
  type: "restock" | "consume" | "adjust";
  source: string;
  notes?: string;
  flow?: InventoryFlow;
  unitCost?: number;
  totalCost?: number;
  expenseId?: string;
  createdAt: string;
}

export type RecipeMap = Record<string, { itemId: string; qty: number }[]>;

// ---------- localStorage-only state (recipes, vehicle map, idempotency) -----
const RECIPE_KEY = "aquawash.inventory.recipes.v1";
const PROCESSED_KEY = "aquawash.inventory.processedOrders.v1";
const VEHICLE_MAP_KEY = "aquawash.inventory.vehicleMap.v1";
const WATER_ITEM_KEY = "aquawash.inventory.waterItem.v1";
const VEHICLE_PROCESSED_KEY = "aquawash.inventory.vehicleProcessed.v1";

function lsLoad<T>(key: string, fallback: T): T {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function lsSave(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

function mlToItemUnit(mL: number, itemUnit: string): number {
  if (canConvert("mL", itemUnit)) {
    const v = convertUnits(mL, "mL", itemUnit);
    return v ?? mL;
  }
  return mL;
}
function lToItemUnit(L: number, itemUnit: string): number {
  if (canConvert("L", itemUnit)) {
    const v = convertUnits(L, "L", itemUnit);
    return v ?? L;
  }
  return L;
}

function rowToItem(r: any): InventoryItem {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    quantity: Number(r.quantity),
    unit: r.unit ?? "",
    threshold: Number(r.threshold ?? 0),
    presetId: r.preset_id ?? undefined,
    subtype: r.subtype ?? undefined,
    recommendedMin: r.recommended_min != null ? Number(r.recommended_min) : undefined,
    recommendedMax: r.recommended_max != null ? Number(r.recommended_max) : undefined,
    unitCost: Number(r.unit_cost ?? 0),
    expenseCategory: r.expense_category ?? undefined,
    supplierId: r.supplier_id ?? undefined,
    packSize: r.pack_size != null ? Number(r.pack_size) : undefined,
  };
}

function rowToTx(r: any): InventoryTransaction {
  return {
    id: r.id,
    itemId: r.item_id,
    itemName: r.item_name,
    delta: Number(r.delta),
    balance: Number(r.balance),
    type: r.type,
    source: r.source,
    notes: r.notes ?? undefined,
    flow: r.flow ?? undefined,
    unitCost: r.unit_cost != null ? Number(r.unit_cost) : undefined,
    totalCost: r.total_cost != null ? Number(r.total_cost) : undefined,
    expenseId: r.expense_id ?? undefined,
    createdAt: r.created_at,
  };
}

export function useInventory() {
  const { tenant } = useTenant();
  const { user } = useAuth();
  const tenantId = tenant?.id ?? null;

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  // localStorage-only state (still client-side for this pass)
  const [recipes, setRecipes] = useState<RecipeMap>(() => lsLoad(RECIPE_KEY, {} as RecipeMap));
  const [vehicleMap, setVehicleMap] = useState<Record<string, string>>(() => lsLoad(VEHICLE_MAP_KEY, {}));
  const [waterItemId, setWaterItemIdState] = useState<string | null>(() => lsLoad<string | null>(WATER_ITEM_KEY, null));
  const processedRef = useRef<Set<string>>(new Set(lsLoad<string[]>(PROCESSED_KEY, [])));
  const vehicleProcessedRef = useRef<Set<string>>(new Set(lsLoad<string[]>(VEHICLE_PROCESSED_KEY, [])));

  // ---- Defaults: inventory category -> expense category ----
  const [categoryDefaults, setCategoryDefaults] = useState<Record<string, string>>({});

  const fetchAll = useCallback(async () => {
    if (!tenantId) { setItems([]); setTransactions([]); setLoading(false); return; }
    setLoading(true);
    const [itemsRes, txRes, defRes] = await Promise.all([
      supabase.from("inventory_items" as any).select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      supabase.from("inventory_transactions" as any).select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1000),
      supabase.from("inventory_category_defaults" as any).select("category, expense_category").eq("tenant_id", tenantId),
    ]);
    setItems(((itemsRes.data as any[]) ?? []).map(rowToItem));
    setTransactions(((txRes.data as any[]) ?? []).map(rowToTx));
    const defs: Record<string, string> = {};
    for (const d of (defRes.data as any[]) ?? []) defs[d.category] = d.expense_category;
    setCategoryDefaults(defs);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`inventory_${tenantId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "inventory_items", filter: `tenant_id=eq.${tenantId}` }, () => fetchAll())
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "inventory_transactions", filter: `tenant_id=eq.${tenantId}` }, () => fetchAll())
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "inventory_category_defaults", filter: `tenant_id=eq.${tenantId}` }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, fetchAll]);

  // -------- Resolve expense category for an item --------
  const resolveExpenseCategory = useCallback((item: InventoryItem): string => {
    if (item.expenseCategory && item.expenseCategory.trim()) return item.expenseCategory;
    if (categoryDefaults[item.category]) return categoryDefaults[item.category];
    return "Supplies";
  }, [categoryDefaults]);

  // -------- Lookup supplier name (lazy fetch when needed) --------
  const lookupSupplierName = useCallback(async (supplierId: string | null | undefined): Promise<string | null> => {
    if (!supplierId) return null;
    const { data } = await supabase.from("suppliers" as any).select("name").eq("id", supplierId).maybeSingle();
    return (data as any)?.name ?? null;
  }, []);

  // -------- Create expense for a restock --------
  const createRestockExpense = useCallback(async (
    item: InventoryItem,
    qty: number,
    notes?: string,
  ): Promise<string | null> => {
    if (!tenantId || qty <= 0) return null;
    const total = +(item.unitCost * qty).toFixed(2);
    if (total <= 0) return null;
    const vendor = await lookupSupplierName(item.supplierId);
    const category = resolveExpenseCategory(item);
    const qtyLabel = `${qty}${item.unit ? ` ${item.unit}` : ""}`;
    const description = `Restock: ${item.name} (${qtyLabel})`;
    const { data, error } = await supabase
      .from("expenses" as any)
      .insert({
        tenant_id: tenantId,
        description,
        amount: total,
        category,
        vendor: vendor ?? null,
        notes: notes ?? null,
        date: new Date().toISOString(),
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error || !data) return null;
    return (data as any).id;
  }, [tenantId, user?.id, lookupSupplierName, resolveExpenseCategory]);

  // -------- Apply a delta + record a transaction (no expense logic here) --------
  const applyDeltaAndLog = useCallback(async (
    item: InventoryItem,
    delta: number,
    entry: {
      type: "restock" | "consume" | "adjust";
      source: string;
      notes?: string;
      flow?: InventoryFlow;
      unitCost?: number;
      totalCost?: number;
      expenseId?: string | null;
    }
  ): Promise<number> => {
    const newBalance = Math.max(0, item.quantity + delta);
    await supabase.from("inventory_items" as any).update({ quantity: newBalance }).eq("id", item.id);
    await supabase.from("inventory_transactions" as any).insert({
      tenant_id: tenantId,
      item_id: item.id,
      item_name: item.name,
      delta,
      balance: newBalance,
      type: entry.type,
      source: entry.source,
      notes: entry.notes ?? null,
      flow: entry.flow ?? null,
      unit_cost: entry.unitCost ?? null,
      total_cost: entry.totalCost ?? null,
      expense_id: entry.expenseId ?? null,
    });
    return newBalance;
  }, [tenantId]);

  // ============== Public mutations ==============

  const addItem = useCallback(async (data: Omit<InventoryItem, "id" | "unitCost"> & { unitCost?: number }) => {
    if (!tenantId) return null;
    const unitCost = data.unitCost ?? 0;
    const { data: row, error } = await supabase
      .from("inventory_items" as any)
      .insert({
        tenant_id: tenantId,
        name: data.name,
        category: data.category,
        subtype: data.subtype ?? null,
        preset_id: data.presetId ?? null,
        unit: data.unit ?? "",
        quantity: data.quantity,
        threshold: data.threshold,
        recommended_min: data.recommendedMin ?? null,
        recommended_max: data.recommendedMax ?? null,
        unit_cost: unitCost,
        expense_category: data.expenseCategory ?? null,
        supplier_id: data.supplierId ?? null,
        pack_size: data.packSize ?? null,
      })
      .select("*")
      .single();
    if (error || !row) return null;
    const item = rowToItem(row);

    if (item.quantity > 0) {
      const expenseId = await createRestockExpense(item, item.quantity, "Initial stock");
      await applyDeltaAndLog(
        { ...item, quantity: 0 }, // log starts from 0; balance becomes item.quantity
        item.quantity,
        {
          type: "restock",
          source: "Initial stock",
          flow: "manual",
          unitCost: item.unitCost,
          totalCost: +(item.unitCost * item.quantity).toFixed(2),
          expenseId,
        }
      );
    }
    return item;
  }, [tenantId, createRestockExpense, applyDeltaAndLog]);

  const updateItem = useCallback(async (id: string, patch: Partial<Omit<InventoryItem, "id">>) => {
    const prev = items.find((i) => i.id === id);
    if (!prev) return;
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.category !== undefined) update.category = patch.category;
    if (patch.subtype !== undefined) update.subtype = patch.subtype ?? null;
    if (patch.presetId !== undefined) update.preset_id = patch.presetId ?? null;
    if (patch.unit !== undefined) update.unit = patch.unit;
    if (patch.quantity !== undefined) update.quantity = patch.quantity;
    if (patch.threshold !== undefined) update.threshold = patch.threshold;
    if (patch.recommendedMin !== undefined) update.recommended_min = patch.recommendedMin ?? null;
    if (patch.recommendedMax !== undefined) update.recommended_max = patch.recommendedMax ?? null;
    if (patch.unitCost !== undefined) update.unit_cost = patch.unitCost;
    if (patch.expenseCategory !== undefined) update.expense_category = patch.expenseCategory ?? null;
    if (patch.supplierId !== undefined) update.supplier_id = patch.supplierId ?? null;
    if (patch.packSize !== undefined) update.pack_size = patch.packSize ?? null;
    await supabase.from("inventory_items" as any).update(update).eq("id", id);

    // Log manual qty edit as adjust (no auto-expense; restocks go through adjustStock).
    if (patch.quantity !== undefined && patch.quantity !== prev.quantity) {
      const delta = patch.quantity - prev.quantity;
      const newItem = { ...prev, ...patch } as InventoryItem;
      let expenseId: string | null = null;
      if (delta > 0 && newItem.unitCost > 0) {
        expenseId = await createRestockExpense(newItem, delta, "Manual edit");
      }
      await supabase.from("inventory_transactions" as any).insert({
        tenant_id: tenantId,
        item_id: id,
        item_name: newItem.name,
        delta,
        balance: patch.quantity,
        type: "adjust",
        source: "Manual edit",
        notes: null,
        flow: "manual",
        unit_cost: delta > 0 ? newItem.unitCost : null,
        total_cost: delta > 0 ? +(newItem.unitCost * delta).toFixed(2) : null,
        expense_id: expenseId,
      });
    }
  }, [items, tenantId, createRestockExpense]);

  const deleteItem = useCallback(async (id: string) => {
    await supabase.from("inventory_items" as any).delete().eq("id", id);
  }, []);

  const adjustStock = useCallback(async (itemId: string, delta: number, notes?: string, source = "Manual") => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    let expenseId: string | null = null;
    if (delta > 0 && item.unitCost > 0) {
      expenseId = await createRestockExpense(item, delta, notes);
    }
    await applyDeltaAndLog(item, delta, {
      type: delta >= 0 ? "restock" : "consume",
      source,
      notes,
      flow: "manual",
      unitCost: delta > 0 ? item.unitCost : undefined,
      totalCost: delta > 0 ? +(item.unitCost * delta).toFixed(2) : undefined,
      expenseId,
    });
  }, [items, applyDeltaAndLog, createRestockExpense]);

  /** Reorder = positive restock that also updates supplier/unit cost on the item. */
  const reorderItem = useCallback(async (args: {
    itemId: string;
    quantity: number;
    unitCost: number;
    supplierId?: string | null;
    notes?: string;
  }) => {
    const prev = items.find((i) => i.id === args.itemId);
    if (!prev) return { ok: false as const, reason: "Item not found" };
    if (args.quantity <= 0) return { ok: false as const, reason: "Quantity must be > 0" };

    // Update item's unit cost & supplier first so subsequent expense uses fresh values.
    const updatedItem: InventoryItem = {
      ...prev,
      unitCost: args.unitCost,
      supplierId: args.supplierId ?? undefined,
    };
    await supabase.from("inventory_items" as any).update({
      unit_cost: args.unitCost,
      supplier_id: args.supplierId ?? null,
    }).eq("id", args.itemId);

    const total = +(args.unitCost * args.quantity).toFixed(2);
    let expenseId: string | null = null;
    if (total > 0) {
      expenseId = await createRestockExpense(updatedItem, args.quantity, args.notes ?? "Reorder");
    }
    await applyDeltaAndLog(updatedItem, args.quantity, {
      type: "restock",
      source: "Reorder",
      notes: args.notes,
      flow: "manual",
      unitCost: args.unitCost,
      totalCost: total,
      expenseId,
    });
    return { ok: true as const };
  }, [items, applyDeltaAndLog, createRestockExpense]);

  // ----- Recipes (still localStorage) -----
  const setRecipe = useCallback((serviceName: string, lines: { itemId: string; qty: number }[]) => {
    const cleaned = lines.filter((l) => l.itemId && l.qty > 0);
    setRecipes((prev) => {
      const next = { ...prev };
      if (cleaned.length === 0) delete next[serviceName];
      else next[serviceName] = cleaned;
      lsSave(RECIPE_KEY, next);
      return next;
    });
  }, []);

  const previewConsumption = useCallback((serviceName: string) => {
    const recipe = recipes[serviceName] ?? [];
    return recipe.map((line) => {
      const item = items.find((i) => i.id === line.itemId);
      const after = item ? item.quantity - line.qty : 0;
      return { itemId: line.itemId, qty: line.qty, item, after, negative: !!item && after < 0 };
    });
  }, [items, recipes]);

  const confirmConsumption = useCallback(async (
    order: { id: string; service: string; orderNumber: string },
    opts: { override?: boolean; overrideNote?: string } = {}
  ): Promise<{ ok: boolean; negativeItems: string[] }> => {
    if (processedRef.current.has(order.id)) return { ok: true, negativeItems: [] };
    const recipe = recipes[order.service] ?? [];
    const negativeItems: string[] = [];
    for (const line of recipe) {
      const item = items.find((i) => i.id === line.itemId);
      if (item && item.quantity - line.qty < 0) negativeItems.push(item.name);
    }
    if (negativeItems.length > 0 && !opts.override) return { ok: false, negativeItems };
    processedRef.current.add(order.id);
    lsSave(PROCESSED_KEY, Array.from(processedRef.current));
    for (const line of recipe) {
      const item = items.find((i) => i.id === line.itemId);
      if (!item) continue;
      const baseNote = order.service;
      const note = opts.override && opts.overrideNote
        ? `${baseNote} · Override: ${opts.overrideNote}`
        : opts.override ? `${baseNote} · Override (negative stock)` : baseNote;
      await applyDeltaAndLog(item, -line.qty, {
        type: "consume",
        source: `Order ${order.orderNumber}`,
        notes: note,
        flow: opts.override ? "override" : "confirmed",
      });
    }
    return { ok: true, negativeItems: [] };
  }, [items, recipes, applyDeltaAndLog]);

  const undoLastTransaction = useCallback(async (): Promise<{ ok: boolean; reason?: string }> => {
    const last = transactions[0];
    if (!last) return { ok: false, reason: "No transactions to undo" };
    if (last.flow === "undo") return { ok: false, reason: "Last entry is already an undo" };
    const item = items.find((i) => i.id === last.itemId);
    if (!item) return { ok: false, reason: "Item no longer exists" };
    await applyDeltaAndLog(item, -last.delta, {
      type: "adjust",
      source: "Undo",
      notes: `Undo of ${last.source}${last.notes ? ` (${last.notes})` : ""}`,
      flow: "undo",
    });
    return { ok: true };
  }, [transactions, items, applyDeltaAndLog]);

  // ----- Vehicle map (localStorage) -----
  const setVehicleMapping = useCallback((concentrateKey: string, itemId: string | null) => {
    setVehicleMap((prev) => {
      const next = { ...prev };
      if (itemId) next[concentrateKey] = itemId;
      else delete next[concentrateKey];
      lsSave(VEHICLE_MAP_KEY, next);
      return next;
    });
  }, []);

  const setWaterItem = useCallback((itemId: string | null) => {
    setWaterItemIdState(itemId);
    lsSave(WATER_ITEM_KEY, itemId);
  }, []);

  const previewVehicleConsumption = useCallback((vehicleInput: string) => {
    const vehicle = matchVehicle(vehicleInput);
    if (!vehicle) return [] as Array<{
      key: string; name: string; itemId: string | null; item: InventoryItem | undefined;
      qty: number; qtyUnit: string; after: number; negative: boolean; mapped: boolean;
    }>;
    const rows = CONCENTRATES.map((row) => {
      const itemId = vehicleMap[row.key] ?? null;
      const item = itemId ? items.find((i) => i.id === itemId) : undefined;
      const mL = row.values[vehicle];
      const qty = item ? mlToItemUnit(mL, item.unit) : mL;
      const qtyUnit = item?.unit ?? row.unit;
      const after = item ? item.quantity - qty : 0;
      return {
        key: row.key, name: row.name, itemId, item, qty: +qty.toFixed(3), qtyUnit,
        after: +after.toFixed(3), negative: !!item && after < 0, mapped: !!item,
      };
    });
    if (waterItemId) {
      const item = items.find((i) => i.id === waterItemId);
      const totalL = WATER.find((w) => w.key === "total_water")!.values[vehicle];
      const qty = item ? lToItemUnit(totalL, item.unit) : totalL;
      const qtyUnit = item?.unit ?? "L";
      const after = item ? item.quantity - qty : 0;
      rows.push({
        key: "total_water", name: "Total water per wash",
        itemId: waterItemId, item, qty: +qty.toFixed(3), qtyUnit,
        after: +after.toFixed(3), negative: !!item && after < 0, mapped: !!item,
      });
    }
    return rows;
  }, [items, vehicleMap, waterItemId]);

  const consumeForWash = useCallback(async (
    args: {
      orderId?: string;
      orderNumber?: string;
      vehicleInput: string;
      source?: string;
      extras?: { itemId: string; qty: number; note?: string }[];
    },
    opts: { override?: boolean; overrideNote?: string } = {}
  ): Promise<{ ok: boolean; negativeItems: string[] }> => {
    const vehicle = matchVehicle(args.vehicleInput);
    const idemKey = args.orderId ? `wash:${args.orderId}` : null;
    if (idemKey && vehicleProcessedRef.current.has(idemKey)) return { ok: true, negativeItems: [] };

    const baseRows = vehicle
      ? previewVehicleConsumption(args.vehicleInput).filter((r) => r.mapped && r.item)
      : [];
    const extraRows = (args.extras ?? [])
      .filter((e) => e.itemId && e.qty > 0)
      .map((e) => {
        const item = items.find((i) => i.id === e.itemId);
        const after = item ? item.quantity - e.qty : 0;
        return { itemId: e.itemId, item, qty: e.qty, after, negative: !!item && after < 0, note: e.note };
      })
      .filter((r) => r.item);

    if (baseRows.length === 0 && extraRows.length === 0) return { ok: true, negativeItems: [] };
    const negativeItems = [
      ...baseRows.filter((r) => r.negative).map((r) => r.item!.name),
      ...extraRows.filter((r) => r.negative).map((r) => r.item!.name),
    ];
    if (negativeItems.length > 0 && !opts.override) return { ok: false, negativeItems };
    if (idemKey) {
      vehicleProcessedRef.current.add(idemKey);
      lsSave(VEHICLE_PROCESSED_KEY, Array.from(vehicleProcessedRef.current));
    }
    const source = args.source ?? (args.orderNumber ? `Order ${args.orderNumber}` : "Wash");

    for (const r of baseRows) {
      const baseNote = `${vehicle} wash`;
      const note = opts.override
        ? `${baseNote} · Override${opts.overrideNote ? `: ${opts.overrideNote}` : " (negative stock)"}`
        : baseNote;
      await applyDeltaAndLog(r.item!, -r.qty, {
        type: "consume", source, notes: note,
        flow: opts.override ? "override" : "auto",
      });
    }
    for (const r of extraRows) {
      const baseNote = `Extra${vehicle ? ` (${vehicle})` : ""}${r.note ? `: ${r.note}` : ""}`;
      const note = opts.override
        ? `${baseNote} · Override${opts.overrideNote ? `: ${opts.overrideNote}` : ""}`
        : baseNote;
      await applyDeltaAndLog(r.item!, -r.qty, {
        type: "consume", source, notes: note,
        flow: opts.override ? "override" : "manual",
      });
    }
    return { ok: true, negativeItems: [] };
  }, [items, previewVehicleConsumption, applyDeltaAndLog]);

  const processCompletedOrders = useCallback(async (
    orders: { id: string; service: string; orderNumber: string; status: string; vehicle?: string }[]
  ) => {
    for (const o of orders) {
      if (o.status !== "completed") continue;
      if (o.vehicle) {
        const idemKey = `wash:${o.id}`;
        if (!vehicleProcessedRef.current.has(idemKey)) {
          const rows = previewVehicleConsumption(o.vehicle).filter((r) => r.mapped && r.item);
          if (rows.length > 0 && !rows.some((r) => r.negative)) {
            vehicleProcessedRef.current.add(idemKey);
            lsSave(VEHICLE_PROCESSED_KEY, Array.from(vehicleProcessedRef.current));
            for (const r of rows) {
              await applyDeltaAndLog(r.item!, -r.qty, {
                type: "consume",
                source: `Order ${o.orderNumber}`,
                notes: `${matchVehicle(o.vehicle) ?? o.vehicle} wash`,
                flow: "auto",
              });
            }
          }
        }
      }
      if (processedRef.current.has(o.id)) continue;
      processedRef.current.add(o.id);
      lsSave(PROCESSED_KEY, Array.from(processedRef.current));
      const recipe = recipes[o.service];
      if (!recipe || recipe.length === 0) continue;
      for (const line of recipe) {
        const item = items.find((i) => i.id === line.itemId);
        if (!item) continue;
        await applyDeltaAndLog(item, -line.qty, {
          type: "consume", source: `Order ${o.orderNumber}`, notes: o.service, flow: "auto",
        });
      }
    }
  }, [items, recipes, previewVehicleConsumption, applyDeltaAndLog]);

  return {
    items,
    transactions,
    recipes,
    vehicleMap,
    waterItemId,
    categoryDefaults,
    loading,
    addItem,
    updateItem,
    deleteItem,
    adjustStock,
    reorderItem,
    setRecipe,
    previewConsumption,
    confirmConsumption,
    undoLastTransaction,
    processCompletedOrders,
    setVehicleMapping,
    setWaterItem,
    previewVehicleConsumption,
    consumeForWash,
    resolveExpenseCategory,
  };
}
