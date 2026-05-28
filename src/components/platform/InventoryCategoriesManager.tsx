import { useEffect, useState } from "react";
import { Loader2, Plus, Boxes, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface TenantRow { id: string; name: string }
interface CategoryRow {
  id: string;
  tenant_id: string;
  name: string;
  sort_order: number;
}

export function InventoryCategoriesManager() {
  const { toast } = useToast();
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [tenantId, setTenantId] = useState<string>("");
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("tenants" as any).select("id, name").order("name").then(({ data }) => {
      const list = ((data as any) ?? []) as TenantRow[];
      setTenants(list);
      if (list[0]) setTenantId(list[0].id);
    });
  }, []);

  const load = async (tid: string) => {
    if (!tid) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("inventory_categories" as any)
      .select("id, tenant_id, name, sort_order")
      .eq("tenant_id", tid)
      .order("sort_order")
      .order("name");
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else setRows(((data as any) ?? []) as CategoryRow[]);
    setLoading(false);
  };

  useEffect(() => { load(tenantId); }, [tenantId]);

  const addCategory = async () => {
    const name = newCat.trim();
    if (!name || !tenantId) return;
    setBusy(true);
    const sort_order = (rows.at(-1)?.sort_order ?? 0) + 10;
    const { error } = await supabase.from("inventory_categories" as any).insert({
      tenant_id: tenantId, name, sort_order,
    });
    setBusy(false);
    if (error) toast({ title: "Add failed", description: error.message, variant: "destructive" });
    else { setNewCat(""); load(tenantId); }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("inventory_categories" as any).delete().eq("id", id);
    if (error) toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    else load(tenantId);
  };

  return (
    <div className="glass-card p-6 space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <Boxes className="w-4 h-4 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">Inventory categories</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Categories shown in the Inventory page Add/Edit form and filters — one list per tenant.
      </p>

      <div className="space-y-1">
        <Label className="text-xs">Tenant</Label>
        <Select value={tenantId} onValueChange={setTenantId}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Select tenant" /></SelectTrigger>
          <SelectContent>
            {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 pt-2">
        <Label className="text-xs">Add category</Label>
        <div className="flex gap-2 max-w-md">
          <Input
            placeholder="e.g. Detergents"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addCategory(); }}
          />
          <Button onClick={addCategory} disabled={busy || !newCat.trim() || !tenantId}>
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No custom categories yet — the app falls back to defaults (Soap, Wax, Towels, Chemicals, Tools, Other).
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
