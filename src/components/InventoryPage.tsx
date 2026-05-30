import { useState, useMemo, useEffect } from "react";
import { Search, Package, Pencil, Trash2, AlertTriangle, Download, ClipboardList, Boxes, Sliders, Plus, Minus, X, PackagePlus, Undo2, SlidersHorizontal, TrendingUp, RefreshCw } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { compatibleUnits, convertUnits, canConvert } from "@/lib/unitConversions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  useInventory,
  type InventoryCategory,
  type InventoryItem,
} from "@/hooks/useInventory";
import { useInventoryCategories } from "@/hooks/useInventoryCategories";
import { useServices } from "@/hooks/useServices";
import { UNIT_OPTIONS, type InventoryPreset } from "@/lib/inventoryPresets";
import { useProductTypes } from "@/hooks/useProductTypes";
import { useSuppliers } from "@/hooks/useSuppliers";
import { useExpenses, EXPENSE_CATEGORIES } from "@/hooks/useExpenses";
import { ReorderDialog } from "@/components/ReorderDialog";
import { UsageReferencePanel } from "@/components/UsageReferencePanel";
import { usePermissions } from "@/hooks/usePermissions";
import { useCurrency } from "@/hooks/useCurrency";
import { BookOpen } from "lucide-react";

interface Props {
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
}

type Tab = "items" | "history" | "usage";

export const InventoryPage = ({ addOpen, onAddOpenChange }: Props) => {
  const { items, transactions, recipes, addItem, updateItem, deleteItem, adjustStock, setRecipe, undoLastTransaction } = useInventory();
  const { suppliers } = useSuppliers();
  const [reordering, setReordering] = useState<InventoryItem | null>(null);
  const { categories: INVENTORY_CATEGORIES } = useInventoryCategories();
  const { presets: INVENTORY_PRESETS } = useProductTypes();
  const { services } = useServices();
  const { can } = usePermissions();
  const { formatPrice } = useCurrency();
  const canEdit = can("inventory.edit");
  const canDelete = can("inventory.delete");
  const canAdjust = can("inventory.adjust");
  const canMapping = can("inventory.mapping");
  const canExport = can("inventory.exportUsage");
  const canHistory = can("inventory.history");

  const [tab, setTab] = useState<Tab>("items");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [presetFilter, setPresetFilter] = useState<string>("all");
  const [historyItemFilter, setHistoryItemFilter] = useState<string>("all");
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [recipesOpen, setRecipesOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<{ item: InventoryItem; mode: "add" | "remove" } | null>(null);
  const [thresholdEditing, setThresholdEditing] = useState<InventoryItem | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<InventoryCategory>(INVENTORY_CATEGORIES[0] ?? "Soap");
  const [quantity, setQuantity] = useState("0");
  const [unit, setUnit] = useState("");
  const [threshold, setThreshold] = useState("0");
  const [presetId, setPresetId] = useState<string>("custom");
  const [subtype, setSubtype] = useState("");
  const [recMin, setRecMin] = useState<string>("");
  const [recMax, setRecMax] = useState<string>("");
  const [unitCost, setUnitCost] = useState<string>("0");
  const [packSize, setPackSize] = useState<string>("1");
  const [supplierId, setSupplierId] = useState<string>("__none");
  const [expenseCategory, setExpenseCategory] = useState<string>("__default");

  const resetForm = () => {
    setName("");
    setCategory(INVENTORY_CATEGORIES[0] ?? "Soap");
    setQuantity("0");
    setUnit("");
    setThreshold("0");
    setPresetId("custom");
    setSubtype("");
    setRecMin("");
    setRecMax("");
    setUnitCost("0");
    setPackSize("1");
    setSupplierId("__none");
    setExpenseCategory("__default");
    setEditing(null);
  };

  useEffect(() => {
    if (addOpen && !editing) resetForm();
  }, [addOpen, editing]);

  const startEdit = (item: InventoryItem) => {
    setEditing(item);
    setName(item.name);
    setCategory(item.category);
    setQuantity(String(item.quantity));
    setUnit(item.unit);
    setThreshold(String(item.threshold));
    setPresetId(item.presetId ?? "custom");
    setSubtype(item.subtype ?? "");
    setRecMin(item.recommendedMin != null ? String(item.recommendedMin) : "");
    setRecMax(item.recommendedMax != null ? String(item.recommendedMax) : "");
    setUnitCost(String(item.unitCost ?? 0));
    setPackSize(item.packSize != null ? String(item.packSize) : "1");
    setSupplierId(item.supplierId ?? "__none");
    setExpenseCategory(item.expenseCategory ?? "__default");
    onAddOpenChange(true);
  };

  const applyPreset = (id: string) => {
    setPresetId(id);
    if (id === "custom") return;
    const p = INVENTORY_PRESETS.find((pp) => pp.id === id);
    if (!p) return;
    setName((prev) => prev || p.name);
    setCategory(p.category);
    setUnit(p.unit);
    setThreshold(String(p.recommendedMin));
  };


  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return toast.error("Name is required");
    const q = Number(quantity);
    const t = Number(threshold);
    const uc = Number(unitCost);
    const ps = packSize === "" ? 1 : Number(packSize);
    if (Number.isNaN(q) || q < 0) return toast.error("Quantity must be positive");
    if (Number.isNaN(t) || t < 0) return toast.error("Threshold must be positive");
    if (Number.isNaN(uc) || uc < 0) return toast.error("Unit cost must be ≥ 0");
    if (Number.isNaN(ps) || ps <= 0) return toast.error("Each must be greater than 0");
    const minN = recMin === "" ? undefined : Number(recMin);
    const maxN = recMax === "" ? undefined : Number(recMax);
    if (minN !== undefined && (Number.isNaN(minN) || minN < 0)) return toast.error("Min must be positive");
    if (maxN !== undefined && (Number.isNaN(maxN) || maxN < 0)) return toast.error("Max must be positive");
    if (minN !== undefined && maxN !== undefined && maxN < minN) return toast.error("Max must be ≥ min");

    const payload = {
      name: trimmed,
      category,
      quantity: q,
      unit: unit.trim(),
      threshold: t,
      presetId: presetId === "custom" ? undefined : presetId,
      subtype: subtype.trim() || undefined,
      recommendedMin: minN,
      recommendedMax: maxN,
      unitCost: uc,
      packSize: ps,
      supplierId: supplierId === "__none" ? undefined : supplierId,
      expenseCategory: expenseCategory === "__default" ? undefined : expenseCategory,
    };

    if (editing) {
      updateItem(editing.id, payload);
      toast.success("Item updated");
    } else {
      addItem(payload);
      toast.success(uc > 0 && q > 0 ? `Item added · expense ${formatPrice(uc * q)} logged` : "Item added");
    }
    onAddOpenChange(false);
    resetForm();
  };


  const handleDelete = (id: string) => {
    if (!confirm("Remove this item from inventory?")) return;
    deleteItem(id);
    toast.success("Item removed");
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (categoryFilter !== "all" && i.category !== categoryFilter) return false;
      if (presetFilter !== "all") {
        if (presetFilter === "custom" ? !!i.presetId : i.presetId !== presetFilter) return false;
      }
      if (!q) return true;
      return i.name.toLowerCase().includes(q)
        || i.category.toLowerCase().includes(q)
        || (i.subtype?.toLowerCase().includes(q) ?? false);
    });
  }, [items, search, categoryFilter, presetFilter]);

  // Effective minimum the item should not fall below.
  const effectiveMin = (item: InventoryItem) =>
    Math.max(item.threshold ?? 0, item.recommendedMin ?? 0);

  const stats = useMemo(() => {
    const total = items.length;
    const lowOut = items.filter((i) => i.quantity <= effectiveMin(i)).length;
    const inStock = total - lowOut;
    return { total, inStock, lowOut };
  }, [items]);

  const stockState = (item: InventoryItem) => {
    if (item.quantity === 0) return { label: "Out of stock", className: "bg-destructive/10 text-destructive" };
    if (item.quantity <= item.threshold) return { label: "Low stock", className: "bg-warning/10 text-warning" };
    if (item.recommendedMin != null && item.quantity < item.recommendedMin)
      return { label: "Below recommended", className: "bg-warning/10 text-warning" };
    return { label: "In stock", className: "bg-success/10 text-success" };
  };

  const presetsInUse = useMemo(() => {
    const ids = new Set(items.map((i) => i.presetId).filter(Boolean) as string[]);
    return INVENTORY_PRESETS.filter((p) => ids.has(p.id));
  }, [items, INVENTORY_PRESETS]);

  const downloadCsv = (filename: string, headers: string[], rows: string[][]) => {
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    if (tab === "history") {
      if (transactions.length === 0) return toast.error("No transactions to export");
      downloadCsv(
        `inventory-transactions-${new Date().toISOString().slice(0, 10)}.csv`,
        ["Timestamp", "Item", "Type", "Source", "Delta", "Balance", "Notes"],
        transactions.map((t) => [
          new Date(t.createdAt).toISOString(),
          t.itemName,
          t.type,
          t.source,
          String(t.delta),
          String(t.balance),
          t.notes ?? "",
        ])
      );
      toast.success("Transactions exported");
      return;
    }
    if (items.length === 0) return toast.error("No items to export");
    downloadCsv(
      `inventory-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Name", "Category", "Quantity", "Unit", "Threshold", "Status"],
      items.map((i) => [
        i.name,
        i.category,
        String(i.quantity),
        i.unit,
        String(i.threshold),
        stockState(i).label,
      ])
    );
    toast.success("Inventory exported");
  };

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard value={stats.total} label="Total Items" tone="foreground" />
        <StatCard value={stats.inStock} label="In Stock" tone="success" />
        <StatCard value={stats.lowOut} label="Low / Out" tone="destructive" />
      </div>

      {/* Tabs + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-secondary border border-border">
          {([
            { id: "items" as const, label: "Items", icon: Boxes },
            { id: "history" as const, label: "History", icon: ClipboardList },
            { id: "usage" as const, label: "Usage Guide", icon: BookOpen },
          ]).filter((t) => t.id !== "history" || canHistory).map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          {canMapping && (
            <button
              onClick={() => setRecipesOpen(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground font-medium text-sm hover:opacity-90 transition-opacity"
              title="Configure how services consume stock"
            >
              <Sliders className="w-4 h-4" />
              <span className="hidden sm:inline">Service Recipes</span>
            </button>
          )}
          {canExport && (
            <button
              onClick={exportCsv}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground font-medium text-sm hover:opacity-90 transition-opacity"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
          )}
        </div>
      </div>

      {tab === "items" && (
        <>
          {/* Search + category */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items..."
                className="pl-9 bg-card border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="bg-card border-border text-foreground sm:w-44">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="all">All Categories</SelectItem>
                {INVENTORY_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={presetFilter} onValueChange={setPresetFilter}>
              <SelectTrigger className="bg-card border-border text-foreground sm:w-56">
                <SelectValue placeholder="All Product Types" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border max-h-72">
                <SelectItem value="all">All Product Types</SelectItem>
                <SelectItem value="custom">Custom (no preset)</SelectItem>
                {(presetsInUse.length > 0 ? presetsInUse : INVENTORY_PRESETS).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <div className="glass-card p-12 flex flex-col items-center justify-center text-center min-h-[280px]">
              <div className="text-5xl mb-4" aria-hidden>📦</div>
              <p className="text-lg font-semibold text-foreground">
                {items.length === 0 ? "No inventory items" : "No items match your filters"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {items.length === 0
                  ? `Click "Add Item" to start tracking stock`
                  : "Try a different search term or category"}
              </p>
            </div>
          ) : (
            <div className="glass-card divide-y divide-border">
              {filtered.map((item) => {
                const state = stockState(item);
                return (
                  <div key={item.id} className="flex items-center gap-4 p-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Package className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground truncate">{item.name}</p>
                        <span className={`status-badge ${state.className}`}>
                          {item.quantity <= effectiveMin(item) && <AlertTriangle className="w-3 h-3 mr-1" />}
                          {state.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(() => {
                          const ps = item.packSize && item.packSize > 0 ? item.packSize : 1;
                          const unitLabel = item.unit ? ` ${item.unit}` : "";
                          const fmtQty = (n: number) =>
                            ps > 1 && item.unit ? `${n} × ${ps}${item.unit}` : `${n}${unitLabel}`;
                          return (
                            <>
                              {item.category} · {fmtQty(item.quantity)} · alert at {fmtQty(item.threshold)}
                              {item.unitCost > 0 && (
                                <> · {formatPrice(item.unitCost)}/each · total {formatPrice(item.unitCost * item.quantity)}</>
                              )}
                            </>
                          );
                        })()}
                      </p>


                    </div>
                    <div className="flex items-center gap-1">
                      {canAdjust && (
                        <button
                          onClick={() => setAdjusting({ item, mode: "add" })}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-success hover:bg-success/10 transition-colors"
                          title="Add stock"
                        >
                          <PackagePlus className="w-4 h-4" />
                        </button>
                      )}
                      {canAdjust && (
                        <button
                          onClick={() => setReordering(item)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                          title="Reorder"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      )}
                      {canAdjust && (
                        <button
                          onClick={() => setAdjusting({ item, mode: "remove" })}
                          disabled={item.quantity <= 0}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-warning hover:bg-warning/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Use / remove stock"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => startEdit(item)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => setThresholdEditing(item)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-info hover:bg-info/10 transition-colors"
                          title="Edit thresholds"
                        >
                          <SlidersHorizontal className="w-4 h-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Remove"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "history" && (
        <TransactionLog
          transactions={
            historyItemFilter === "all"
              ? transactions
              : transactions.filter((t) => t.itemId === historyItemFilter)
          }
          allTransactions={transactions}
          items={items}
          itemFilter={historyItemFilter}
          onItemFilterChange={setHistoryItemFilter}
          onUndo={() => setUndoOpen(true)}
          onAdjust={(item, mode) => setAdjusting({ item, mode })}
        />
      )}

      {tab === "usage" && <UsageReferencePanel />}

      <ThresholdsDialog
        item={thresholdEditing}
        onOpenChange={(o) => { if (!o) setThresholdEditing(null); }}
        onSave={(patch) => {
          if (!thresholdEditing) return;
          updateItem(thresholdEditing.id, patch);
          toast.success("Thresholds updated");
          setThresholdEditing(null);
        }}
      />

      <UndoDialog
        open={undoOpen}
        last={transactions[0] ?? null}
        onOpenChange={setUndoOpen}
        onConfirm={async () => {
          const result = await undoLastTransaction();
          setUndoOpen(false);
          if (result.ok) toast.success("Transaction reversed");
          else toast.error(result.reason ?? "Could not undo");
        }}
      />

      {/* Add / Edit dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { onAddOpenChange(o); if (!o) resetForm(); }}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Item" : "Add Inventory Item"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 mt-2">
            {/* Product type preset */}
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Product Type</Label>
              <Select value={presetId} onValueChange={applyPreset}>
                <SelectTrigger className="bg-secondary border-border text-foreground">
                  <SelectValue placeholder="Pick a preset or use custom" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border max-h-72">
                  <SelectItem value="custom">Custom (define manually)</SelectItem>
                  {INVENTORY_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.recommendedMin}–{p.recommendedMax} {p.unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Choosing a preset auto-fills category, measurement unit, and low-stock threshold.
              </p>

            </div>

            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Microfiber towels" maxLength={100} className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
            </div>




            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm text-secondary-foreground">Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as InventoryCategory)}>
                  <SelectTrigger className="bg-secondary border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {INVENTORY_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-secondary-foreground">Unit Symbol</Label>
                <Select value={UNIT_OPTIONS.includes(unit as typeof UNIT_OPTIONS[number]) ? unit : "__custom"} onValueChange={(v) => { if (v !== "__custom") setUnit(v); else setUnit(""); }}>
                  <SelectTrigger className="bg-secondary border-border text-foreground">
                    <SelectValue placeholder="Select unit" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {UNIT_OPTIONS.map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                    <SelectItem value="__custom">Custom…</SelectItem>
                  </SelectContent>
                </Select>
                {!UNIT_OPTIONS.includes(unit as typeof UNIT_OPTIONS[number]) && (
                  <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Custom unit" maxLength={16} className="mt-1 bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label className="text-sm text-secondary-foreground">Each{unit ? ` (${unit})` : ""}</Label>
                <Input type="number" min="0" step="0.1" value={packSize} onChange={(e) => setPackSize(e.target.value)} placeholder="1" className="bg-secondary border-border text-foreground" />
                <p className="text-[11px] text-muted-foreground">Size per unit (e.g. 5 = a 5{unit || "L"} bottle).</p>
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-secondary-foreground">Quantity (units)</Label>
                <Input type="number" min="0" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="bg-secondary border-border text-foreground" />
                {Number(packSize) > 0 && Number(quantity) > 0 && unit && (
                  <p className="text-[11px] text-muted-foreground">
                    = {(Number(packSize) * Number(quantity)).toString()} {unit} total
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-secondary-foreground">Low at (units)</Label>
                <Input type="number" min="0" step="1" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="bg-secondary border-border text-foreground" />
              </div>
            </div>



            {/* Cost / supplier / expense category */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
              <div className="space-y-2">
                <Label className="text-sm text-secondary-foreground">Unit cost (per item)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  placeholder="0.00"
                  className="bg-secondary border-border text-foreground"
                />
                <p className="text-[11px] text-muted-foreground">
                  Expense = unit cost × quantity captured (not multiplied by the unit of measurement).
                  {Number(unitCost) > 0 && Number(quantity) > 0 && (
                    <> Total: <span className="text-foreground font-mono">{formatPrice(Number(unitCost) * Number(quantity))}</span></>
                  )}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm text-secondary-foreground">Supplier</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger className="bg-secondary border-border text-foreground">
                    <SelectValue placeholder="No supplier" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border max-h-72">
                    <SelectItem value="__none">No supplier</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Manage the list in Settings → Workspace → Suppliers.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Expense category override</Label>
              <Select value={expenseCategory} onValueChange={setExpenseCategory}>
                <SelectTrigger className="bg-secondary border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border max-h-72">
                  <SelectItem value="__default">Use category default</SelectItem>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Optional. Overrides the default expense category mapped to "{category}".
              </p>
            </div>

            {Number(unitCost) > 0 && Number(quantity) > 0 && !editing && (
              <p className="text-[11px] text-info">
                Capturing this item will auto-log an expense of {formatPrice(Number(unitCost) * Number(quantity))}.
              </p>
            )}

            <button type="submit" className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity">
              {editing ? "Save Changes" : "Add Item"}
            </button>
          </form>
        </DialogContent>
      </Dialog>

      <RecipesDialog
        open={recipesOpen}
        onOpenChange={setRecipesOpen}
        services={services.map((s) => s.name)}
        items={items}
        recipes={recipes}
        onSave={setRecipe}
      />

      <AdjustStockDialog
        request={adjusting}
        onOpenChange={(o) => { if (!o) setAdjusting(null); }}
        onConfirm={(qty, notes) => {
          if (!adjusting) return;
          const { item, mode } = adjusting;
          const signed = mode === "add" ? qty : -qty;
          adjustStock(item.id, signed, notes, mode === "add" ? "Restock" : "Manual usage");
          toast.success(
            mode === "add"
              ? `Added ${qty}${item.unit ? ` ${item.unit}` : ""} to ${item.name}`
              : `Removed ${qty}${item.unit ? ` ${item.unit}` : ""} from ${item.name}`
          );
          setAdjusting(null);
        }}
      />

      <ReorderDialog
        item={reordering}
        onOpenChange={(o) => { if (!o) setReordering(null); }}
      />
    </div>
  );
};

function StatCard({ value, label, tone }: { value: number; label: string; tone: "foreground" | "success" | "destructive" }) {
  const colorMap = {
    foreground: "text-foreground",
    success: "text-success",
    destructive: "text-destructive",
  };
  return (
    <div className="glass-card p-6 text-center">
      <p className={`text-4xl font-bold ${colorMap[tone]}`}>{value}</p>
      <p className="text-sm text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

// ----------------------------- Transaction Log ------------------------------
type HistoryRange = "7d" | "30d" | "90d" | "all";
const RANGE_LABELS: Record<HistoryRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

function rangeStart(range: HistoryRange): number {
  if (range === "all") return 0;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function TransactionLog({
  transactions,
  allTransactions,
  items,
  itemFilter,
  onItemFilterChange,
  onUndo,
  onAdjust,
}: {
  transactions: ReturnType<typeof useInventory>["transactions"];
  allTransactions: ReturnType<typeof useInventory>["transactions"];
  items: InventoryItem[];
  itemFilter: string;
  onItemFilterChange: (v: string) => void;
  onUndo: () => void;
  onAdjust: (item: InventoryItem, mode: "add" | "remove") => void;
}) {
  const [range, setRange] = useState<HistoryRange>("30d");
  const [orderQuery, setOrderQuery] = useState("");
  const startTs = rangeStart(range);

  const inRange = useMemo(
    () => transactions.filter((t) => {
      if (new Date(t.createdAt).getTime() < startTs) return false;
      if (orderQuery.trim()) {
        const q = orderQuery.trim().toLowerCase();
        const hay = `${t.source} ${t.notes ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }),
    [transactions, startTs, orderQuery]
  );

  const selectedItem = itemFilter === "all" ? null : items.find((i) => i.id === itemFilter) ?? null;
  const itemUnit = selectedItem?.unit ?? "";

  const summary = useMemo(() => {
    let added = 0, removed = 0;
    for (const t of inRange) {
      if (t.delta > 0) added += t.delta;
      else removed += -t.delta;
    }
    return { added, removed, net: added - removed, count: inRange.length };
  }, [inRange]);

  // Build chart series of running balance over time for the selected item.
  // Use the canonical balance recorded on each transaction so the line
  // exactly mirrors the stored history.
  const chartData = useMemo(() => {
    if (!selectedItem) return [] as { ts: number; label: string; balance: number }[];
    const itemTx = allTransactions
      .filter((t) => t.itemId === selectedItem.id)
      .slice()
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const start = startTs;
    let baseline: number | null = null;
    const points: { ts: number; label: string; balance: number }[] = [];
    for (const t of itemTx) {
      const ts = new Date(t.createdAt).getTime();
      if (ts < start) {
        baseline = t.balance;
        continue;
      }
      if (baseline !== null && points.length === 0) {
        points.push({ ts: start, label: new Date(start).toLocaleDateString(), balance: baseline });
      }
      points.push({
        ts,
        label: new Date(ts).toLocaleDateString(),
        balance: t.balance,
      });
    }
    if (points.length > 0) {
      // anchor end of chart to "now" using the last balance
      points.push({ ts: Date.now(), label: "Now", balance: points[points.length - 1].balance });
    } else if (baseline !== null) {
      // no events in range but item existed before — show flat line
      points.push({ ts: start, label: new Date(start).toLocaleDateString(), balance: baseline });
      points.push({ ts: Date.now(), label: "Now", balance: baseline });
    }
    return points;
  }, [allTransactions, selectedItem, startTs]);

  const filterControl = (
    <Select value={itemFilter} onValueChange={onItemFilterChange}>
      <SelectTrigger className="bg-card border-border text-foreground sm:w-56">
        <SelectValue placeholder="All items" />
      </SelectTrigger>
      <SelectContent className="bg-card border-border max-h-72">
        <SelectItem value="all">All items</SelectItem>
        {items.map((it) => (
          <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const rangeControl = (
    <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-secondary border border-border">
      {(Object.keys(RANGE_LABELS) as HistoryRange[]).map((r) => (
        <button
          key={r}
          onClick={() => setRange(r)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
            range === r ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {RANGE_LABELS[r]}
        </button>
      ))}
    </div>
  );

  const canUndo = transactions.length > 0
    && !transactions[0].notes?.startsWith("Undo of ")
    && itemFilter === "all";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {filterControl}
          {rangeControl}
          <input
            type="search"
            value={orderQuery}
            onChange={(e) => setOrderQuery(e.target.value)}
            placeholder="Filter by order # or vehicle…"
            className="h-9 px-3 rounded-lg bg-card border border-border text-foreground text-xs sm:w-56 placeholder:text-muted-foreground"
          />
        </div>
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-secondary-foreground text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          title={canUndo ? "Reverse the most recent transaction" : "Undo only available without item filter"}
        >
          <Undo2 className="w-3.5 h-3.5" />
          Undo last transaction
        </button>
      </div>

      {/* Summary card */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <p className="text-sm font-semibold text-foreground">
              {selectedItem ? selectedItem.name : "All items"} · {RANGE_LABELS[range]}
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground">{summary.count} transactions</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <SummaryStat label="Added" value={`+${summary.added}${itemUnit ? ` ${itemUnit}` : ""}`} tone="success" />
          <SummaryStat label="Removed" value={`−${summary.removed}${itemUnit ? ` ${itemUnit}` : ""}`} tone="destructive" />
          <SummaryStat
            label="Net change"
            value={`${summary.net >= 0 ? "+" : ""}${summary.net}${itemUnit ? ` ${itemUnit}` : ""}`}
            tone={summary.net >= 0 ? "success" : "destructive"}
          />
        </div>
      </div>

      {/* Per-item line chart */}
      {selectedItem && (
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-foreground">Quantity over time</p>
            <p className="text-[11px] text-muted-foreground">
              Current balance: <span className="font-mono text-foreground">{selectedItem.quantity}{itemUnit ? ` ${itemUnit}` : ""}</span>
            </p>
          </div>
          {chartData.length < 2 ? (
            <p className="text-xs text-muted-foreground italic py-8 text-center">
              Not enough data points in this range to draw a trend.
            </p>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="label"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [`${v}${itemUnit ? ` ${itemUnit}` : ""}`, "Balance"]}
                  />
                  {selectedItem.threshold > 0 && (
                    <ReferenceLine
                      y={selectedItem.threshold}
                      stroke="hsl(var(--warning))"
                      strokeDasharray="4 4"
                      label={{ value: "Alert", fontSize: 10, fill: "hsl(var(--warning))", position: "right" }}
                    />
                  )}
                  {selectedItem.recommendedMin != null && (
                    <ReferenceLine
                      y={selectedItem.recommendedMin}
                      stroke="hsl(var(--info))"
                      strokeDasharray="2 4"
                      label={{ value: "Min", fontSize: 10, fill: "hsl(var(--info))", position: "right" }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="balance"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "hsl(var(--primary))" }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Transactions list */}
      {inRange.length === 0 ? (
        <div className="glass-card p-12 flex flex-col items-center justify-center text-center min-h-[200px]">
          <div className="text-5xl mb-4" aria-hidden>🧾</div>
          <p className="text-lg font-semibold text-foreground">
            {orderQuery.trim()
              ? "No transactions match that order/vehicle"
              : itemFilter === "all" ? "No transactions yet" : "No transactions for this item"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Stock changes from completed washes and manual edits will appear here
          </p>
        </div>
      ) : (
        <div className="glass-card divide-y divide-border">
          {inRange.map((t) => {
            const positive = t.delta > 0;
            const tone = positive ? "text-success" : "text-destructive";
            const bg = positive ? "bg-success/10" : "bg-destructive/10";
            const rowItem = items.find((i) => i.id === t.itemId);
            return (
              <div key={t.id} className="flex items-center gap-4 p-4">
                <div className={`w-10 h-10 rounded-lg ${bg} ${tone} flex items-center justify-center shrink-0 font-mono font-bold text-sm`}>
                  {positive ? "+" : "−"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground truncate">{t.itemName}</p>
                    <span className="text-xs text-muted-foreground">· {t.source}</span>
                    <FlowBadge flow={t.flow} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(t.createdAt).toLocaleString()} · balance {t.balance}
                    {t.notes ? ` · ${t.notes}` : ""}
                  </p>
                </div>
                <p className={`text-sm font-mono font-semibold ${tone} shrink-0`}>
                  {positive ? "+" : ""}{t.delta}
                </p>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => rowItem && onAdjust(rowItem, "add")}
                    disabled={!rowItem}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-success hover:bg-success/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Add stock to this item"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => rowItem && onAdjust(rowItem, "remove")}
                    disabled={!rowItem || rowItem.quantity <= 0}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-warning hover:bg-warning/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Remove stock from this item"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone: "success" | "destructive" | "foreground" }) {
  const colorMap = {
    success: "text-success",
    destructive: "text-destructive",
    foreground: "text-foreground",
  };
  return (
    <div className="rounded-lg bg-secondary/50 border border-border p-3">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-mono font-bold ${colorMap[tone]} mt-0.5`}>{value}</p>
    </div>
  );
}

// --------------------------- Thresholds Dialog ------------------------------
function ThresholdsDialog({
  item,
  onOpenChange,
  onSave,
}: {
  item: InventoryItem | null;
  onOpenChange: (o: boolean) => void;
  onSave: (patch: { threshold: number; recommendedMin?: number; recommendedMax?: number }) => void;
}) {
  const [threshold, setThreshold] = useState("0");
  const [recMin, setRecMin] = useState("");
  const [recMax, setRecMax] = useState("");

  useEffect(() => {
    if (item) {
      setThreshold(String(item.threshold));
      setRecMin(item.recommendedMin != null ? String(item.recommendedMin) : "");
      setRecMax(item.recommendedMax != null ? String(item.recommendedMax) : "");
    }
  }, [item]);

  if (!item) return null;
  const t = Number(threshold);
  const minN = recMin === "" ? undefined : Number(recMin);
  const maxN = recMax === "" ? undefined : Number(recMax);
  const error =
    Number.isNaN(t) || t < 0 ? "Alert threshold must be ≥ 0"
      : minN !== undefined && (Number.isNaN(minN) || minN < 0) ? "Recommended min must be ≥ 0"
      : maxN !== undefined && (Number.isNaN(maxN) || maxN < 0) ? "Recommended max must be ≥ 0"
      : minN !== undefined && maxN !== undefined && maxN < minN ? "Max must be ≥ min"
      : null;

  const projectedState = (() => {
    const eff = Math.max(t || 0, minN ?? 0);
    if (item.quantity === 0) return { label: "Out of stock", className: "text-destructive" };
    if (item.quantity <= (t || 0)) return { label: "Low stock", className: "text-warning" };
    if (minN != null && item.quantity < minN) return { label: "Below recommended", className: "text-warning" };
    if (item.quantity > eff) return { label: "In stock", className: "text-success" };
    return { label: "OK", className: "text-success" };
  })();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (error) return;
    onSave({ threshold: t, recommendedMin: minN, recommendedMax: maxN });
  };

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Thresholds · {item.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 mt-2">
          <p className="text-xs text-muted-foreground">
            Current stock: <span className="font-mono text-foreground">{item.quantity}{item.unit ? ` ${item.unit}` : ""}</span>
          </p>
          <div className="space-y-2">
            <Label className="text-sm text-secondary-foreground">Alert at (low-stock badge){item.unit ? ` (${item.unit})` : ""}</Label>
            <Input type="number" min="0" step="0.1" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="bg-secondary border-border text-foreground" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Recommended min</Label>
              <Input type="number" min="0" step="0.1" value={recMin} onChange={(e) => setRecMin(e.target.value)} placeholder="optional" className="bg-secondary border-border text-foreground" />
            </div>
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Recommended max</Label>
              <Input type="number" min="0" step="0.1" value={recMax} onChange={(e) => setRecMax(e.target.value)} placeholder="optional" className="bg-secondary border-border text-foreground" />
            </div>
          </div>
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              New badge: <span className={`font-semibold ${projectedState.className}`}>{projectedState.label}</span>
            </p>
          )}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => onOpenChange(false)} className="flex-1 py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-sm hover:opacity-90 transition-opacity">
              Cancel
            </button>
            <button type="submit" disabled={!!error} className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">
              Save Thresholds
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------- Recipes Dialog -------------------------------
interface RecipesDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  services: string[];
  items: InventoryItem[];
  recipes: Record<string, { itemId: string; qty: number }[]>;
  onSave: (serviceName: string, lines: { itemId: string; qty: number }[]) => void;
}

function RecipesDialog({ open, onOpenChange, services, items, recipes, onSave }: RecipesDialogProps) {
  const [activeService, setActiveService] = useState<string>("");
  const [lines, setLines] = useState<{ itemId: string; qty: number }[]>([]);

  useEffect(() => {
    if (open) {
      const first = services[0] || "";
      setActiveService(first);
      setLines(recipes[first] ? [...recipes[first]] : []);
    }
  }, [open, services, recipes]);

  const switchService = (name: string) => {
    setActiveService(name);
    setLines(recipes[name] ? [...recipes[name]] : []);
  };

  const addLine = () => setLines((prev) => [...prev, { itemId: items[0]?.id ?? "", qty: 1 }]);
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));
  const updateLine = (idx: number, patch: Partial<{ itemId: string; qty: number }>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const save = () => {
    if (!activeService) return;
    onSave(activeService, lines);
    toast.success(`Recipe saved for ${activeService}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Service Recipes</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-1">
          Define how much stock each service uses. Quantities are deducted automatically when a wash is marked completed.
        </p>

        {services.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Add services first to define recipes.</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Add inventory items first.</p>
        ) : (
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Service</Label>
              <Select value={activeService} onValueChange={switchService}>
                <SelectTrigger className="bg-secondary border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {services.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">Items consumed per wash</Label>
              {lines.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2">No items consumed by this service yet.</p>
              ) : (
                <div className="space-y-2">
                  {lines.map((line, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Select value={line.itemId} onValueChange={(v) => updateLine(idx, { itemId: v })}>
                        <SelectTrigger className="bg-secondary border-border text-foreground flex-1">
                          <SelectValue placeholder="Select item" />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          {items.map((it) => (
                            <SelectItem key={it.id} value={it.id}>{it.name}{it.unit ? ` (${it.unit})` : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        min="0"
                        step="0.1"
                        value={line.qty}
                        onChange={(e) => updateLine(idx, { qty: Number(e.target.value) || 0 })}
                        className="w-20 bg-secondary border-border text-foreground"
                      />
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={addLine}
                className="flex items-center gap-1.5 text-xs font-medium text-primary hover:opacity-80"
              >
                <Plus className="w-3 h-3" />
                Add item line
              </button>
            </div>

            <RecipeImpactPreview lines={lines} items={items} />

            <div className="flex gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="flex-1 py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
              >
                Close
              </button>
              <button
                type="button"
                onClick={save}
                className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
              >
                Save Recipe
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --------------------------- Adjust Stock Dialog ----------------------------
function AdjustStockDialog({
  request,
  onOpenChange,
  onConfirm,
}: {
  request: { item: InventoryItem; mode: "add" | "remove" } | null;
  onOpenChange: (o: boolean) => void;
  onConfirm: (qty: number, notes: string) => void;
}) {
  const NOTES_MAX = 120;
  const [qty, setQty] = useState("1");
  const [entryUnit, setEntryUnit] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (request) {
      setQty("1");
      setNotes("");
      setConfirming(false);
      setEntryUnit(request.item.unit || "");
    }
  }, [request]);

  const item = request?.item ?? null;
  const mode = request?.mode ?? "add";
  const storageUnit = item?.unit ?? "";
  const altUnits = useMemo(() => (storageUnit ? compatibleUnits(storageUnit) : []), [storageUnit]);
  const hasUnitChoice = altUnits.length > 1;
  const ps = item?.packSize && item.packSize > 0 ? item.packSize : 1;
  const fmtQty = (n: number) =>
    ps > 1 && storageUnit ? `${n} × ${ps}${storageUnit}` : `${n}${storageUnit ? ` ${storageUnit}` : ""}`;

  const parsedEntry = Number(qty);
  const entryValid = Number.isFinite(parsedEntry) && parsedEntry > 0;
  // Convert the entered quantity to the item's storage unit so totals stay
  // consistent regardless of what unit the user typed.
  const convertedQty = useMemo(() => {
    if (!entryValid || !storageUnit) return parsedEntry;
    if (!entryUnit || entryUnit === storageUnit) return parsedEntry;
    if (!canConvert(entryUnit, storageUnit)) return null;
    return convertUnits(parsedEntry, entryUnit, storageUnit);
  }, [parsedEntry, entryValid, entryUnit, storageUnit]);

  // Display rounded to a reasonable precision but keep raw value for math.
  const storedQty = convertedQty == null ? null : Math.round(convertedQty * 1000) / 1000;
  const notesValid = notes.length <= NOTES_MAX;
  const overRemoval = item && mode === "remove" && storedQty != null && storedQty > item.quantity;
  const error = !qty.trim()
    ? "Quantity is required"
    : !entryValid
      ? "Quantity must be greater than zero"
      : storedQty == null
        ? `Cannot convert ${entryUnit} to ${storageUnit}`
        : !notesValid
          ? `Notes must be ${NOTES_MAX} characters or fewer`
          : overRemoval
            ? `Cannot remove more than current stock (${item!.quantity}${storageUnit ? ` ${storageUnit}` : ""})`
            : null;

  const handlePrimary = (e: React.FormEvent) => {
    e.preventDefault();
    if (!item || error || storedQty == null) return;
    if (!confirming) { setConfirming(true); return; }
    onConfirm(storedQty, notes.trim());
  };

  const newBalance = item && storedQty != null
    ? (mode === "add" ? item.quantity + storedQty : item.quantity - storedQty)
    : 0;

  return (
    <Dialog open={!!request} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "Add stock to" : "Remove stock from"} {item?.name}</DialogTitle>
        </DialogHeader>
        {item && (
          <form onSubmit={handlePrimary} className="space-y-4 mt-2">
            <p className="text-xs text-muted-foreground">
              Current: <span className="font-mono text-foreground">{fmtQty(item.quantity)}</span>
            </p>
            <div className="space-y-2">
              <Label className="text-sm text-secondary-foreground">
                {mode === "add" ? "Add" : "Remove"} quantity
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={qty}
                  onChange={(e) => { setQty(e.target.value); setConfirming(false); }}
                  autoFocus
                  aria-invalid={!entryValid}
                  className="bg-secondary border-border text-foreground flex-1"
                />
                {hasUnitChoice ? (
                  <Select value={entryUnit} onValueChange={(v) => { setEntryUnit(v); setConfirming(false); }}>
                    <SelectTrigger className="bg-secondary border-border text-foreground w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border">
                      {altUnits.map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : storageUnit ? (
                  <span className="px-3 py-2 rounded-md bg-secondary border border-border text-sm text-muted-foreground font-mono">{storageUnit}</span>
                ) : null}
              </div>
              {hasUnitChoice && entryUnit !== storageUnit && storedQty != null && (
                <p className="text-[11px] text-muted-foreground">
                  Stored as <span className="font-mono text-foreground">{storedQty} {storageUnit}</span>
                </p>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-secondary-foreground">Notes (optional)</Label>
                <span className={`text-[10px] font-mono ${notes.length > NOTES_MAX ? "text-destructive" : "text-muted-foreground"}`}>
                  {notes.length}/{NOTES_MAX}
                </span>
              </div>
              <Input
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setConfirming(false); }}
                placeholder={mode === "add" ? "e.g. Supplier delivery #4521" : "e.g. Spillage / used for detail job"}
                maxLength={NOTES_MAX}
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                New balance: <span className={`font-mono ${mode === "add" ? "text-success" : "text-warning"}`}>
                  {fmtQty(newBalance)}
                </span>
              </p>
            )}

            {confirming && !error && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs text-foreground">
                Confirm {mode === "add" ? "adding" : "removing"}{" "}
                <span className="font-mono font-semibold">
                  {mode === "add" ? "+" : "−"}{fmtQty(storedQty!)}
                </span>{" "}
                {mode === "add" ? "to" : "from"} <span className="font-semibold">{item.name}</span>?
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => (confirming ? setConfirming(false) : onOpenChange(false))}
                className="flex-1 py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
              >
                {confirming ? "Back" : "Cancel"}
              </button>
              <button
                type="submit"
                disabled={!!error}
                className={`flex-1 py-2.5 rounded-lg font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed ${
                  mode === "add" ? "bg-primary text-primary-foreground" : "bg-warning text-warning-foreground"
                }`}
              >
                {confirming
                  ? (mode === "add" ? "Confirm Add" : "Confirm Removal")
                  : (mode === "add" ? "Add to Stock" : "Remove from Stock")}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------- Recipe Impact Preview ----------------------------
function RecipeImpactPreview({
  lines,
  items,
}: {
  lines: { itemId: string; qty: number }[];
  items: InventoryItem[];
}) {
  const rows = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lines) {
      if (!l.itemId || !l.qty || l.qty <= 0) continue;
      map.set(l.itemId, (map.get(l.itemId) ?? 0) + l.qty);
    }
    return Array.from(map.entries()).map(([itemId, total]) => {
      const it = items.find((i) => i.id === itemId);
      const after = it ? it.quantity - total : 0;
      return {
        itemId,
        total,
        item: it,
        after,
        negative: !!it && after < 0,
        low: !!it && after >= 0 && after <= it.threshold,
      };
    });
  }, [lines, items]);

  const negativeCount = rows.filter((r) => r.negative).length;

  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground">Impact preview · per wash</p>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {rows.length} item{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      {negativeCount > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {negativeCount} item{negativeCount === 1 ? "" : "s"} will go negative with current stock — restock before completing this service.
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No items will be deducted when this service is completed.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => {
            const tone = r.negative ? "text-destructive" : r.low ? "text-warning" : "text-success";
            const displayed = r.item ? Math.max(0, r.after) : 0;
            return (
              <li key={r.itemId} className="flex items-center justify-between text-xs">
                <span className="text-foreground truncate pr-2">
                  {r.item?.name ?? "Unknown item"}
                </span>
                <span className="font-mono text-muted-foreground shrink-0">
                  −{r.total}{r.item?.unit ? ` ${r.item.unit}` : ""}
                  {r.item && (
                    <span className={`ml-2 ${tone}`}>
                      → {r.negative ? `${r.after}` : displayed}{r.item.unit ? ` ${r.item.unit}` : ""}
                      {r.negative && " ⚠"}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ----------------------------- Flow Badge ----------------------------------
function FlowBadge({ flow }: { flow?: import("@/hooks/useInventory").InventoryFlow }) {
  if (!flow) return null;
  const map: Record<string, { label: string; cls: string; title: string }> = {
    confirmed: { label: "Confirmed", cls: "bg-success/10 text-success border-success/20", title: "Deducted via wash confirmation preview" },
    auto: { label: "Auto", cls: "bg-warning/10 text-warning border-warning/20", title: "Auto-deducted by fallback (no preview confirmation)" },
    override: { label: "Override", cls: "bg-destructive/10 text-destructive border-destructive/20", title: "Confirmed with negative-stock override" },
    manual: { label: "Manual", cls: "bg-secondary text-secondary-foreground border-border", title: "Manual restock or edit" },
    undo: { label: "Undo", cls: "bg-info/10 text-info border-info/20", title: "Reversal of a previous transaction" },
  };
  const m = map[flow];
  if (!m) return null;
  return (
    <span title={m.title} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${m.cls}`}>
      {m.label}
    </span>
  );
}

// ----------------------------- Undo Dialog ---------------------------------
function UndoDialog({
  open,
  last,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  last: import("@/hooks/useInventory").InventoryTransaction | null;
  onOpenChange: (o: boolean) => void;
  onConfirm: () => void;
}) {
  const canUndo = !!last && last.flow !== "undo";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Undo last transaction</DialogTitle>
        </DialogHeader>
        {!last ? (
          <p className="text-sm text-muted-foreground">No transactions to undo.</p>
        ) : !canUndo ? (
          <p className="text-sm text-muted-foreground">
            The most recent entry is already an undo. Nothing else to reverse.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Item</span>
                <span className="font-semibold text-foreground">{last.itemName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Source</span>
                <span className="text-foreground">{last.source}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Original change</span>
                <span className={`font-mono font-semibold ${last.delta > 0 ? "text-success" : "text-destructive"}`}>
                  {last.delta > 0 ? "+" : ""}{last.delta}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Will apply</span>
                <span className={`font-mono font-semibold ${-last.delta > 0 ? "text-success" : "text-destructive"}`}>
                  {-last.delta > 0 ? "+" : ""}{-last.delta}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="text-muted-foreground">Balance after undo</span>
                <span className="font-mono font-semibold text-foreground">
                  {last.balance + (-last.delta)}
                </span>
              </div>
              {last.notes && (
                <p className="text-muted-foreground italic pt-1 border-t border-border">
                  {last.notes}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              A new "Undo" transaction will be recorded in the log for traceability.
            </p>
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex-1 py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canUndo}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Undo2 className="w-4 h-4" />
            Confirm Undo
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
