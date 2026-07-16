import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useAuth } from "@/hooks/useAuth";
import { useLiveTable } from "@/offline/useLiveTable";
import { db } from "@/offline/db";
import { enqueueOutbox } from "@/offline/sync";
import { offlineInsert, offlineUpdate, offlineDelete } from "@/offline/offlineWrite";
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
  unitCost: number;
  expenseCategory?: string;
  supplierId?: string;
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

// ---------- localStorage state ----------
const RECIPE_KEY = "aquawash.inventory.recipes.v1";
const PROCESSED_KEY = "aquawash.inventory.processedOrders.v1";
const VEHICLE_MAP_KEY = "aquawash.inventory.vehicleMap.v1";
const WATER_ITEM_KEY = "aquawash.inventory.waterItem.v1";
const VEHICLE_PROCESSED_KEY = "aquawash.inventory.vehicleProcessed.v1";
const CATEGORY_DEFAULTS_KEY = "aquawash.inventory.categoryDefaults.v1";

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
  if (canConvert("mL", itemUnit)) { const v = convertUnits(mL, "mL", itemUnit); return v ?? mL; }
  return mL;
}
function lToItemUnit(L: number, itemUnit: string): number {
  if (canConvert("L", itemUnit)) { const v = convertUnits(L, "L", itemUnit); return v ?? L; }
  return L;
}

function rowToItem(r: any): InventoryItem {
  return {
    id: r.id, name: r.name, category: r.category,
    quantity: Number(r.quantity), unit: r.unit ?? "",
    threshold: Number(r.threshold ?? 0),
    presetId: r.preset_id ?? undefined, subtype: r.subtype ?? undefined,
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
    id: r.id, itemId: r.item_id, itemName: r.item_name,
    delta: Number(r.delta), balance: Number(r.balance),
    type: r.type, source: r.source, notes: r.notes ?? undefined,
    flow: r.flow ?? undefined,
    unitCost: r.unit_cost != null ? Number(r.unit_cost) : undefined,
    totalCost: r.total_cost != null ? Number(r.total_cost) : undefined,
    expenseId: r.expense_id ?? undefined, createdAt: r.created_at,
  };
}

export function useInventory() {
  const { tenant } = useTenant();
  const { user } = useAuth();
  const tenantId = tenant?.id ?? null;

  // Reads from Dexie mirror — instant, offline-first
  const itemRows = useLiveTable<any>(tenantId, "inventory_items");
  const txRows = useLiveTable<any>(tenantId, "inventory_transactions");

  const items = useMemo<InventoryItem[]>(() => {
    const list = (itemRows ?? []).map(rowToItem);
    const sortKey = new Map((itemRows ?? []).map((r: any) => [r.id, r?.created_at ?? r?.id ?? ""]));
    list.sort((a, b) => { const ka = sortKey.get(a.id) ?? ""; const kb = sortKey.get(b.id) ?? ""; return ka < kb ? 1 : -1; });
    return list;
  }, [itemRows]);

  const transactions = useMemo<InventoryTransaction[]>(() => {
    const list = (txRows ?? []).map(rowToTx);
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return list.slice(0, 1000);
  }, [txRows]);

  const [recipes, setRecipes] = useState<RecipeMap>(() => lsLoad(RECIPE_KEY, {} as RecipeMap));
  const [vehicleMap, setVehicleMap] = useState<Record<string, string>>(() => lsLoad(VEHICLE_MAP_KEY, {}));
  const [waterItemId, setWaterItemIdState] = useState<string | null>(() => lsLoad<string | null>(WATER_ITEM_KEY, null));
  const processedRef = useRef<Set<string>>(new Set(lsLoad<string[]>(PROCESSED_KEY, [])));
  const vehicleProcessedRef = useRef<Set<string>>(new Set(lsLoad<string[]>(VEHICLE_PROCESSED_KEY, [])));
  const [categoryDefaults, setCategoryDefaults] = useState<Record<string, string>>(
    () => lsLoad(CATEGORY_DEFAULTS_KEY, {})
  );
  const [auxLoading, setAuxLoading] = useState(true);
  const loading = auxLoading || itemRows === undefined || txRows === undefined;
  const WATER_KEY = "__water__";

  // Load category defaults + vehicle map — from Supabase when online, from localStorage when offline
  const fetchAux = useCallback(async () => {
    if (!tenantId) { setAuxLoading(false); return; }
    setAuxLoading(true);

    if (navigator.onLine) {
      try {
        const [defRes, mapRes] = await Promise.all([
          supabase.from("inventory_category_defaults" as any).select("category, expense_category").eq("tenant_id", tenantId),
          supabase.from("inventory_vehicle_map" as any).select("key, item_id").eq("tenant_id", tenantId),
        ]);
        const defs: Record<string, string> = {};
        for (const d of (defRes.data as any[]) ?? []) defs[d.category] = d.expense_category;
        setCategoryDefaults(defs);
        lsSave(CATEGORY_DEFAULTS_KEY, defs);

        const map: Record<string, string> = {};
        let water: string | null = null;
        for (const row of (mapRes.data as any[]) ?? []) {
          if (row.key === WATER_KEY) water = row.item_id;
          else map[row.key] = row.item_id;
        }
        setVehicleMap(map);
        setWaterItemIdState(water);
        lsSave(VEHICLE_MAP_KEY, map);
        lsSave(WATER_ITEM_KEY, water);
      } catch { /* use cached values */ }
    }
    // Offline: already loaded from localStorage in useState initializers
    setAuxLoading(false);
  }, [tenantId]);

  useEffect(() => { fetchAux(); }, [fetchAux]);

  useEffect(() => {
    if (!tenantId || !navigator.onLine) return;
    const ch = supabase
      .channel(`inventory_aux_${tenantId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "inventory_category_defaults", filter: `tenant_id=eq.${tenantId}` }, () => fetchAux())
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "inventory_vehicle_map", filter: `tenant_id=eq.${tenantId}` }, () => fetchAux())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, fetchAux]);

  const resolveExpenseCategory = useCallback((item: InventoryItem): string => {
    if (item.expenseCategory?.trim()) return item.expenseCategory;
    if (categoryDefaults[item.category]) return categoryDefaults[item.category];
    return "Supplies";
  }, [categoryDefaults]);

  // Lookup supplier name — from Dexie when offline, Supabase when online
  const lookupSupplierName = useCallback(async (supplierId: string | null | undefined): Promise<string | null> => {
    if (!supplierId) return null;
    // Try local Dexie first
    try {
      const local = await (db as any).suppliers.get(supplierId);
      if (local?.name) return local.name;
    } catch { /* ignore */ }
    // Fall back to Supabase if online
    if (navigator.onLine) {
      const { data } = await supabase.from("suppliers" as any).select("name").eq("id", supplierId).maybeSingle();
      return (data as any)?.name ?? null;
    }
    return null;
  }, []);

  // Create expense for a restock — offline-first via Dexie + outbox
  const createRestockExpense = useCallback(async (
    item: InventoryItem, qty: number, notes?: string,
  ): Promise<string | null> => {
    if (!tenantId || qty <= 0) return null;
    const total = +(item.unitCost * qty).toFixed(2);
    if (total <= 0) return null;
    const vendor = await lookupSupplierName(item.supplierId);
    const category = resolveExpenseCategory(item);
    const qtyLabel = `${qty}${item.unit ? ` ${item.unit}` : ""}`;
    const description = `Restock: ${item.name} (${qtyLabel})`;
    const row = await offlineInsert("expenses", tenantId, {
      description, amount: total, category,
      vendor: vendor ?? null, notes: notes ?? null,
      date: new Date().toISOString().slice(0, 10),
      created_by: user?.id ?? null,
    });
    return row.id as string;
  }, [tenantId, user?.id, lookupSupplierName, resolveExpenseCategory]);

  // Core: apply delta to item + log transaction — all offline-first
  const applyDeltaAndLog = useCallback(async (
    item: InventoryItem, delta: number,
    entry: {
      type: "restock" | "consume" | "adjust";
      source: string; notes?: string; flow?: InventoryFlow;
      unitCost?: number; totalCost?: number; expenseId?: string | null;
    }
  ): Promise<number> => {
    if (!tenantId) return item.quantity;
    const newBalance = Math.max(0, item.quantity + delta);

    // Update item quantity in Dexie
    await offlineUpdate("inventory_items", tenantId, item.id, { quantity: newBalance });

    // Log transaction in Dexie
    await offlineInsert("inventory_transactions", tenantId, {
      item_id: item.id, item_name: item.name,
      delta, balance: newBalance, type: entry.type, source: entry.source,
      notes: entry.notes ?? null, flow: entry.flow ?? null,
      unit_cost: entry.unitCost ?? null, total_cost: entry.totalCost ?? null,
      expense_id: entry.expenseId ?? null,
    });

    return newBalance;
  }, [tenantId]);

  // ============== Public mutations — all offline-first ==============

  const addItem = useCallback(async (data: Omit<InventoryItem, "id" | "unitCost"> & { unitCost?: number }) => {
    if (!tenantId) return null;
    const unitCost = data.unitCost ?? 0;
    const row = await offlineInsert("inventory_items", tenantId, {
      name: data.name, category: data.category,
      subtype: data.subtype ?? null, preset_id: data.presetId ?? null,
      unit: data.unit ?? "", quantity: data.quantity, threshold: data.threshold,
      recommended_min: data.recommendedMin ?? null, recommended_max: data.recommendedMax ?? null,
      unit_cost: unitCost, expense_category: data.expenseCategory ?? null,
      supplier_id: data.supplierId ?? null, pack_size: data.packSize ?? null,
    });
    const item = rowToItem(row);

    if (item.quantity > 0) {
      const expenseId = await createRestockExpense(item, item.quantity, "Initial stock");
      await applyDeltaAndLog(
        { ...item, quantity: 0 }, item.quantity,
        { type: "restock", source: "Initial stock", flow: "manual",
          unitCost: item.unitCost, totalCost: +(item.unitCost * item.quantity).toFixed(2), expenseId },
      );
    }
    return item;
  }, [tenantId, createRestockExpense, applyDeltaAndLog]);

  const updateItem = useCallback(async (id: string, patch: Partial<Omit<InventoryItem, "id">>) => {
    const prev = items.find((i) => i.id === id);
    if (!prev || !tenantId) return;
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

    await offlineUpdate("inventory_items", tenantId, id, update);

    if (patch.quantity !== undefined && patch.quantity !== prev.quantity) {
      const delta = patch.quantity - prev.quantity;
      const newItem = { ...prev, ...patch } as InventoryItem;
      await offlineInsert("inventory_transactions", tenantId, {
        item_id: id, item_name: newItem.name, delta, balance: patch.quantity,
        type: "adjust", source: "Manual edit",
        notes: "Edited via item form — no expense logged",
        flow: "manual", unit_cost: null, total_cost: null, expense_id: null,
      });
    }
  }, [items, tenantId]);

  const deleteItem = useCallback(async (id: string) => {
    if (!tenantId) return;
    await offlineDelete("inventory_items", tenantId, id);
  }, [tenantId]);

  // Merge a duplicate inventory item into a target:
  // - reassigns all transactions of `sourceId` to `targetId`
  // - adds source.quantity onto target (logs an adjust entry so history is clear)
  // - updates vehicle map / waterItemId if they referenced source
  // - deletes source
  const mergeItems = useCallback(async (sourceId: string, targetId: string) => {
    if (!tenantId) return { ok: false as const, reason: "No workspace" };
    if (sourceId === targetId) return { ok: false as const, reason: "Same item" };
    const source = items.find((i) => i.id === sourceId);
    const target = items.find((i) => i.id === targetId);
    if (!source || !target) return { ok: false as const, reason: "Item not found" };

    // Reassign all source transactions to target (both in Dexie and Supabase outbox)
    const sourceTx = (txRows ?? []).filter((r: any) => r.item_id === sourceId);
    for (const tx of sourceTx) {
      await offlineUpdate("inventory_transactions", tenantId, tx.id, {
        item_id: targetId,
        item_name: target.name,
      });
    }

    // Transfer stock and log an adjust entry on the target
    const transferred = Number(source.quantity) || 0;
    if (transferred > 0) {
      await applyDeltaAndLog(target, transferred, {
        type: "adjust",
        source: "Merge duplicate",
        notes: `Merged from "${source.name}" (${transferred}${source.unit ? ` ${source.unit}` : ""})`,
        flow: "manual",
      });
    }

    // Rewire vehicle map / water link if source was linked
    if (waterItemId === sourceId) {
      await setWaterItemIdSafe(targetId);
    }
    const linkedKeys = Object.entries(vehicleMap).filter(([, id]) => id === sourceId).map(([k]) => k);
    for (const key of linkedKeys) {
      await setVehicleMappingSafe(key, targetId);
    }

    // Delete the source item
    await offlineDelete("inventory_items", tenantId, sourceId);
    return { ok: true as const, transferred };
  }, [items, txRows, tenantId, applyDeltaAndLog, waterItemId, vehicleMap]);

  // Local helpers that mirror setWaterItem / setVehicleMapping without needing the
  // full callbacks to be declared above. Kept lightweight (Dexie/Supabase only).
  async function setWaterItemIdSafe(itemId: string) {
    setWaterItemIdState(itemId);
    lsSave(WATER_ITEM_KEY, itemId);
    if (navigator.onLine && tenantId) {
      supabase.from("inventory_vehicle_map" as any).upsert(
        { tenant_id: tenantId, key: WATER_KEY, item_id: itemId },
        { onConflict: "tenant_id,key" },
      ).then(() => {});
    }
  }
  async function setVehicleMappingSafe(key: string, itemId: string) {
    setVehicleMap((prev) => { const next = { ...prev, [key]: itemId }; lsSave(VEHICLE_MAP_KEY, next); return next; });
    if (navigator.onLine && tenantId) {
      supabase.from("inventory_vehicle_map" as any).upsert(
        { tenant_id: tenantId, key, item_id: itemId },
        { onConflict: "tenant_id,key" },
      ).then(() => {});
    }
  }


  const adjustStock = useCallback(async (itemId: string, delta: number, notes?: string, source = "Manual") => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    let expenseId: string | null = null;
    if (delta > 0 && item.unitCost > 0) expenseId = await createRestockExpense(item, delta, notes);
    await applyDeltaAndLog(item, delta, {
      type: delta >= 0 ? "restock" : "consume", source, notes, flow: "manual",
      unitCost: delta > 0 ? item.unitCost : undefined,
      totalCost: delta > 0 ? +(item.unitCost * delta).toFixed(2) : undefined,
      expenseId,
    });
  }, [items, applyDeltaAndLog, createRestockExpense]);

  const reorderItem = useCallback(async (args: {
    itemId: string; quantity: number; unitCost: number;
    supplierId?: string | null; notes?: string;
  }) => {
    if (!tenantId) return { ok: false as const, reason: "No workspace" };
    const prev = items.find((i) => i.id === args.itemId);
    if (!prev) return { ok: false as const, reason: "Item not found" };
    if (args.quantity <= 0) return { ok: false as const, reason: "Quantity must be > 0" };

    const updatedItem: InventoryItem = { ...prev, unitCost: args.unitCost, supplierId: args.supplierId ?? undefined };
    await offlineUpdate("inventory_items", tenantId, args.itemId, {
      unit_cost: args.unitCost, supplier_id: args.supplierId ?? null,
    });

    const total = +(args.unitCost * args.quantity).toFixed(2);
    let expenseId: string | null = null;
    if (total > 0) expenseId = await createRestockExpense(updatedItem, args.quantity, args.notes ?? "Reorder");
    await applyDeltaAndLog(updatedItem, args.quantity, {
      type: "restock", source: "Reorder", notes: args.notes, flow: "manual",
      unitCost: args.unitCost, totalCost: total, expenseId,
    });
    return { ok: true as const };
  }, [items, tenantId, applyDeltaAndLog, createRestockExpense]);

  // ----- Recipes (localStorage) -----
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
      const note = opts.override && opts.overrideNote ? `${baseNote} · Override: ${opts.overrideNote}`
        : opts.override ? `${baseNote} · Override (negative stock)` : baseNote;
      await applyDeltaAndLog(item, -line.qty, {
        type: "consume", source: `Order ${order.orderNumber}`, notes: note,
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
      type: "adjust", source: "Undo",
      notes: `Undo of ${last.source}${last.notes ? ` (${last.notes})` : ""}`,
      flow: "undo",
    });
    return { ok: true };
  }, [transactions, items, applyDeltaAndLog]);

  // ----- Vehicle map — localStorage + Supabase when online -----
  const setVehicleMapping = useCallback(async (concentrateKey: string, itemId: string | null) => {
    if (!tenantId) return;
    setVehicleMap((prev) => {
      const next = { ...prev };
      if (itemId) next[concentrateKey] = itemId;
      else delete next[concentrateKey];
      lsSave(VEHICLE_MAP_KEY, next);
      return next;
    });
    // Sync to Supabase when online (non-blocking)
    if (navigator.onLine) {
      if (itemId) {
        supabase.from("inventory_vehicle_map" as any).upsert(
          { tenant_id: tenantId, key: concentrateKey, item_id: itemId },
          { onConflict: "tenant_id,key" },
        ).then(() => {});
      } else {
        supabase.from("inventory_vehicle_map" as any)
          .delete().eq("tenant_id", tenantId).eq("key", concentrateKey).then(() => {});
      }
    }
  }, [tenantId]);

  const setWaterItem = useCallback(async (itemId: string | null) => {
    if (!tenantId) return;
    setWaterItemIdState(itemId);
    lsSave(WATER_ITEM_KEY, itemId);
    if (navigator.onLine) {
      if (itemId) {
        supabase.from("inventory_vehicle_map" as any).upsert(
          { tenant_id: tenantId, key: WATER_KEY, item_id: itemId },
          { onConflict: "tenant_id,key" },
        ).then(() => {});
      } else {
        supabase.from("inventory_vehicle_map" as any)
          .delete().eq("tenant_id", tenantId).eq("key", WATER_KEY).then(() => {});
      }
    }
  }, [tenantId]);

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
      orderId?: string; orderNumber?: string; vehicleInput: string; source?: string;
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
      await applyDeltaAndLog(r.item!, -r.qty, { type: "consume", source, notes: note, flow: opts.override ? "override" : "auto" });
    }
    for (const r of extraRows) {
      const baseNote = `Extra${vehicle ? ` (${vehicle})` : ""}${r.note ? `: ${r.note}` : ""}`;
      const note = opts.override
        ? `${baseNote} · Override${opts.overrideNote ? `: ${opts.overrideNote}` : ""}` : baseNote;
      await applyDeltaAndLog(r.item!, -r.qty, { type: "consume", source, notes: note, flow: opts.override ? "override" : "manual" });
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
                type: "consume", source: `Order ${o.orderNumber}`,
                notes: `${matchVehicle(o.vehicle) ?? o.vehicle} wash`, flow: "auto",
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

  const commitWashConsumption = useCallback(async (
    args: {
      orderId: string; orderNumber: string; service: string; vehicleInput?: string;
      rows: { itemId: string; qty: number; source: "service" | "vehicle" | "extra"; note?: string }[];
    },
    opts: { override?: boolean; overrideNote?: string } = {}
  ): Promise<{ ok: boolean; negativeItems: string[] }> => {
    const byItem = new Map<string, { qty: number; sources: Set<string>; notes: string[] }>();
    for (const r of args.rows) {
      if (!r.itemId || r.qty <= 0) continue;
      const cur = byItem.get(r.itemId) ?? { qty: 0, sources: new Set<string>(), notes: [] };
      cur.qty = +(cur.qty + r.qty).toFixed(3);
      cur.sources.add(r.source);
      if (r.note) cur.notes.push(r.note);
      byItem.set(r.itemId, cur);
    }

    const alreadyDone =
      processedRef.current.has(args.orderId) ||
      vehicleProcessedRef.current.has(`wash:${args.orderId}`);
    if (alreadyDone) {
      processedRef.current.add(args.orderId);
      vehicleProcessedRef.current.add(`wash:${args.orderId}`);
      lsSave(PROCESSED_KEY, Array.from(processedRef.current));
      lsSave(VEHICLE_PROCESSED_KEY, Array.from(vehicleProcessedRef.current));
      return { ok: true, negativeItems: [] };
    }

    const negativeItems: string[] = [];
    for (const [itemId, agg] of byItem) {
      const item = items.find((i) => i.id === itemId);
      if (item && item.quantity - agg.qty < 0) negativeItems.push(item.name);
    }
    if (negativeItems.length > 0 && !opts.override) return { ok: false, negativeItems };

    processedRef.current.add(args.orderId);
    vehicleProcessedRef.current.add(`wash:${args.orderId}`);
    lsSave(PROCESSED_KEY, Array.from(processedRef.current));
    lsSave(VEHICLE_PROCESSED_KEY, Array.from(vehicleProcessedRef.current));

    const vehicleLabel = args.vehicleInput ? matchVehicle(args.vehicleInput) ?? args.vehicleInput : null;
    for (const [itemId, agg] of byItem) {
      const item = items.find((i) => i.id === itemId);
      if (!item) continue;
      const parts = [args.service];
      if (vehicleLabel && agg.sources.has("vehicle")) parts.push(`${vehicleLabel} usage`);
      if (agg.notes.length > 0) parts.push(agg.notes.join("; "));
      let note = parts.filter(Boolean).join(" · ");
      if (opts.override) note += ` · Override${opts.overrideNote ? `: ${opts.overrideNote}` : " (negative stock)"}`;
      await applyDeltaAndLog(item, -agg.qty, {
        type: "consume", source: `Order ${args.orderNumber}`, notes: note,
        flow: opts.override ? "override" : "auto",
      });
    }
    return { ok: true, negativeItems: [] };
  }, [items, applyDeltaAndLog]);

  return {
    items, transactions, recipes, vehicleMap, waterItemId, categoryDefaults, loading,
    addItem, updateItem, deleteItem, adjustStock, reorderItem,
    setRecipe, previewConsumption, confirmConsumption, undoLastTransaction,
    processCompletedOrders, setVehicleMapping, setWaterItem,
    previewVehicleConsumption, consumeForWash, commitWashConsumption,
    resolveExpenseCategory,
  };
}
