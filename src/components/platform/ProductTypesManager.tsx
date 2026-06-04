import { useEffect, useState } from "react";
import { Loader2, Plus, Package, Trash2, Pencil, Save, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useInventoryCategories } from "@/hooks/useInventoryCategories";

const UNIT_OPTIONS = ["L", "ml", "kg", "g", "pcs", "box", "pack"];

interface ProductTypeRow {
  id: string;
  name: string;
  category: string;
  unit: string;
  recommended_min: number;
  recommended_max: number;
  description: string | null;
  sort_order: number;
}

interface DraftForm {
  name: string;
  category: string;
  unit: string;
  recommended_min: string;
  recommended_max: string;
  description: string;
}

const EMPTY_DRAFT: DraftForm = {
  name: "", category: "", unit: "L", recommended_min: "0", recommended_max: "0", description: "",
};

/**
 * Manages the GLOBAL product-type catalog used by every tenant's Inventory
 * page when adding new items. Seeded with the previously hard-coded
 * INVENTORY_PRESETS list.
 */
export function ProductTypesManager() {
  const { toast } = useToast();
  const { categories } = useInventoryCategories();
  const [rows, setRows] = useState<ProductTypeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<DraftForm>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("product_types" as any)
      .select("id, name, category, unit, recommended_min, recommended_max, description, sort_order")
      .order("sort_order")
      .order("name");
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else setRows(((data as any) ?? []) as ProductTypeRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const resetDraft = () => { setDraft(EMPTY_DRAFT); setEditingId(null); };

  const startEdit = (r: ProductTypeRow) => {
    setEditingId(r.id);
    setDraft({
      name: r.name,
      category: r.category,
      unit: r.unit,
      recommended_min: String(r.recommended_min),
      recommended_max: String(r.recommended_max),
      description: r.description ?? "",
    });
  };

  const save = async () => {
    const name = draft.name.trim();
    if (!name) return toast({ title: "Name required", variant: "destructive" });
    if (!draft.category) return toast({ title: "Category required", variant: "destructive" });
    const min = Number(draft.recommended_min) || 0;
    const max = Number(draft.recommended_max) || 0;
    setBusy(true);
    const payload = {
      name, category: draft.category, unit: draft.unit || "pcs",
      recommended_min: min, recommended_max: max,
      description: draft.description.trim() || null,
    };
    let error;
    if (editingId) {
      ({ error } = await supabase.from("product_types" as any).update(payload).eq("id", editingId));
    } else {
      const sort_order = (rows.at(-1)?.sort_order ?? 0) + 10;
      ({ error } = await supabase.from("product_types" as any).insert({ ...payload, sort_order }));
    }
    setBusy(false);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else { resetDraft(); load(); }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this product type from the global catalog?")) return;
    const { error } = await supabase.from("product_types" as any).delete().eq("id", id);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else load();
  };

  return (
    <div className="glass-card p-6 space-y-4 max-w-4xl">
      <div className="flex items-center gap-2">
        <Package className="w-4 h-4 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">Product types</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        <strong>Global</strong> presets that pre-fill category, unit and recommended stock when a tenant adds an inventory item.
      </p>

      {/* Editor */}
      <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/20">
        <div className="text-sm font-medium text-foreground">
          {editingId ? "Edit product type" : "Add product type"}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Car Wash Shampoo / Soap" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v })}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Unit</Label>
            <Select value={draft.unit} onValueChange={(v) => setDraft({ ...draft, unit: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNIT_OPTIONS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Recommended min</Label>
              <Input type="number" min={0} value={draft.recommended_min}
                onChange={(e) => setDraft({ ...draft, recommended_min: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Recommended max</Label>
              <Input type="number" min={0} value={draft.recommended_max}
                onChange={(e) => setDraft({ ...draft, recommended_max: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs">Description (optional)</Label>
            <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="e.g. High-foam wash shampoo" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          {editingId && (
            <Button variant="outline" size="sm" onClick={resetDraft}>
              <X className="w-4 h-4 mr-1" /> Cancel
            </Button>
          )}
          <Button onClick={save} disabled={busy}>
            {editingId ? <><Save className="w-4 h-4 mr-1" />Save</> : <><Plus className="w-4 h-4 mr-1" />Add</>}
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No product types yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Category</th>
                <th className="text-left px-3 py-2">Unit</th>
                <th className="text-left px-3 py-2">Recommended</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{r.name}</div>
                    {r.description && <div className="text-xs text-muted-foreground italic">{r.description}</div>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.category}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.unit}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.recommended_min}–{r.recommended_max} {r.unit}</td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(r.id)} className="text-destructive hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
