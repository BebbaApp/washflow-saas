import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Plus, Tag, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface CategoryRow {
  id: string;
  tenant_id: string | null;
  name: string;
  sort_order: number;
  parent_id: string | null;
}

/**
 * Manages the GLOBAL expense category tree (tenant_id IS NULL). Every
 * tenant reads from this list; only platform admins can edit it.
 */
export function ExpenseCategoriesManager() {
  const { toast } = useToast();
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [newCat, setNewCat] = useState("");
  const [newSub, setNewSub] = useState("");
  const [subParentId, setSubParentId] = useState<string>("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("expense_categories" as any)
      .select("id, tenant_id, name, sort_order, parent_id")
      .is("tenant_id", null)
      .order("sort_order")
      .order("name");
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else setRows(((data as any) ?? []) as CategoryRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const tree = useMemo(() => {
    const parents = rows.filter((r) => !r.parent_id);
    return parents.map((p) => ({
      ...p,
      children: rows.filter((r) => r.parent_id === p.id),
    }));
  }, [rows]);

  const addCategory = async () => {
    const name = newCat.trim();
    if (!name) return;
    setBusy(true);
    const sort_order = (tree.at(-1)?.sort_order ?? 0) + 10;
    const { error } = await supabase.from("expense_categories" as any).insert({
      tenant_id: null, name, sort_order, parent_id: null,
    });
    setBusy(false);
    if (error) toast({ title: "Add failed", description: error.message, variant: "destructive" });
    else { setNewCat(""); load(); }
  };

  const addSubcategory = async () => {
    const name = newSub.trim();
    if (!name || !subParentId) return;
    setBusy(true);
    const siblings = rows.filter((r) => r.parent_id === subParentId);
    const sort_order = (siblings.at(-1)?.sort_order ?? 0) + 10;
    const { error } = await supabase.from("expense_categories" as any).insert({
      tenant_id: null, name, sort_order, parent_id: subParentId,
    });
    setBusy(false);
    if (error) toast({ title: "Add failed", description: error.message, variant: "destructive" });
    else {
      setNewSub("");
      setExpanded((e) => ({ ...e, [subParentId]: true }));
      load();
    }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("expense_categories" as any).delete().eq("id", id);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else load();
  };

  return (
    <div className="glass-card p-6 space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <Tag className="w-4 h-4 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">Expense categories & subcategories</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        These are <strong>global</strong> — every tenant sees the same list in the Expenses page.
        Add a category here when a tenant requests a new one.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
        <div className="space-y-2">
          <Label className="text-xs">Add category</Label>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. Utilities"
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addCategory(); }}
            />
            <Button onClick={addCategory} disabled={busy || !newCat.trim()}>
              <Plus className="w-4 h-4 mr-1" /> Add
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs">Add subcategory</Label>
          <div className="flex gap-2">
            <Select value={subParentId} onValueChange={setSubParentId}>
              <SelectTrigger className="w-44 shrink-0"><SelectValue placeholder="Parent" /></SelectTrigger>
              <SelectContent>
                {tree.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              placeholder="e.g. Electricity"
              value={newSub}
              onChange={(e) => setNewSub(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addSubcategory(); }}
            />
            <Button onClick={addSubcategory} disabled={busy || !newSub.trim() || !subParentId}>
              <Plus className="w-4 h-4 mr-1" /> Add
            </Button>
          </div>
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : tree.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No global categories yet — add the first one above.</div>
        ) : (
          <ul className="divide-y divide-border">
            {tree.map((p) => {
              const isOpen = expanded[p.id] ?? true;
              return (
                <li key={p.id} className="text-sm">
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <button
                      onClick={() => setExpanded((e) => ({ ...e, [p.id]: !isOpen }))}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                      <span className="font-medium text-foreground">{p.name}</span>
                      <span className="text-xs text-muted-foreground">({p.children.length})</span>
                    </button>
                    <Button variant="ghost" size="sm" onClick={() => remove(p.id)} className="text-destructive hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  {isOpen && p.children.length > 0 && (
                    <ul className="bg-muted/30 border-t border-border divide-y divide-border">
                      {p.children.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2 pl-10 pr-3 py-2">
                          <span className="text-foreground">{c.name}</span>
                          <Button variant="ghost" size="sm" onClick={() => remove(c.id)} className="text-destructive hover:text-destructive">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
