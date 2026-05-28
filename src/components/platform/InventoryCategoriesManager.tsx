import { useEffect, useState } from "react";
import { Loader2, Plus, Boxes, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface CategoryRow {
  id: string;
  tenant_id: string | null;
  name: string;
  sort_order: number;
}

/**
 * Manages the GLOBAL inventory category list (tenant_id IS NULL). Used by
 * every tenant; only platform admins can edit.
 */
export function InventoryCategoriesManager() {
  const { toast } = useToast();
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("inventory_categories" as any)
      .select("id, tenant_id, name, sort_order")
      .is("tenant_id", null)
      .order("sort_order")
      .order("name");
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else setRows(((data as any) ?? []) as CategoryRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const addCategory = async () => {
    const name = newCat.trim();
    if (!name) return;
    setBusy(true);
    const sort_order = (rows.at(-1)?.sort_order ?? 0) + 10;
    const { error } = await supabase.from("inventory_categories" as any).insert({
      tenant_id: null, name, sort_order,
    });
    setBusy(false);
    if (error) toast({ title: "Add failed", description: error.message, variant: "destructive" });
    else { setNewCat(""); load(); }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("inventory_categories" as any).delete().eq("id", id);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else load();
  };

  return (
    <div className="glass-card p-6 space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <Boxes className="w-4 h-4 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">Inventory categories</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        <strong>Global</strong> categories used by every tenant's Inventory page.
      </p>

      <div className="space-y-2 pt-2">
        <Label className="text-xs">Add category</Label>
        <div className="flex gap-2 max-w-md">
          <Input
            placeholder="e.g. Detergents"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addCategory(); }}
          />
          <Button onClick={addCategory} disabled={busy || !newCat.trim()}>
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No global categories yet — add the first one above.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm text-foreground">{r.name}</span>
                <Button variant="ghost" size="sm" onClick={() => remove(r.id)} className="text-destructive hover:text-destructive">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
