import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";

export interface CategoryNode {
  id: string;
  name: string;
  sort_order: number;
  parent_id: string | null;
  subcategories: CategoryNode[];
}

/**
 * Two-level expense category tree (category → subcategories).
 *
 * Rows are sourced from `public.expense_categories`:
 *   - tenant_id IS NULL → global catalog managed in the Platform Console.
 *     Visible to every workspace.
 *   - tenant_id = current tenant → tenant-specific custom categories.
 *
 * Tenants opt in by simply using the global list; if they need a unique
 * category they ask the platform admin to add it (or add it as a tenant row).
 */
export function useExpenseCategories() {
  const { tenant } = useTenant();
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("expense_categories" as any)
      .select("id, name, sort_order, parent_id, tenant_id")
      .order("sort_order")
      .order("name");
    // Read global rows + optionally tenant-specific rows. When signed out
    // we still surface the global catalog so the form is not empty.
    if (tenant?.id) {
      query = query.or(`tenant_id.is.null,tenant_id.eq.${tenant.id}`);
    } else {
      query = query.is("tenant_id", null);
    }
    const { data, error } = await query;
    if (!error && data) {
      const rows = (data as any[]) as { id: string; name: string; sort_order: number; parent_id: string | null }[];
      const parents = rows.filter((r) => !r.parent_id);
      const childByParent = new Map<string, typeof rows>();
      rows.filter((r) => r.parent_id).forEach((r) => {
        const arr = childByParent.get(r.parent_id!) ?? [];
        arr.push(r); childByParent.set(r.parent_id!, arr);
      });
      setTree(parents.map((p) => ({
        id: p.id, name: p.name, sort_order: p.sort_order, parent_id: null,
        subcategories: (childByParent.get(p.id) ?? []).map((c) => ({
          id: c.id, name: c.name, sort_order: c.sort_order, parent_id: p.id, subcategories: [],
        })),
      })));
    } else {
      setTree([]);
    }
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const ch = supabase
      .channel(`expense_categories_${tenant?.id ?? "global"}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "expense_categories" },
        () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenant?.id, fetchAll]);

  const categories = useMemo(() => tree.map((c) => c.name), [tree]);
  const subcategoriesFor = useCallback(
    (categoryName: string) => tree.find((c) => c.name === categoryName)?.subcategories.map((s) => s.name) ?? [],
    [tree]
  );

  return { tree, categories, subcategoriesFor, loading, refresh: fetchAll };
}

const TONE_PALETTE = [
  "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  "bg-teal-500/15 text-teal-600 dark:text-teal-400",
];

const FIXED_TONES: Record<string, string> = {
  Supplies: TONE_PALETTE[0],
  Utilities: TONE_PALETTE[1],
  Salaries: TONE_PALETTE[2],
  Maintenance: TONE_PALETTE[3],
  Rent: TONE_PALETTE[4],
  Marketing: TONE_PALETTE[5],
  Other: "bg-muted text-muted-foreground",
};

export function categoryTone(name: string): string {
  if (FIXED_TONES[name]) return FIXED_TONES[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TONE_PALETTE[hash % TONE_PALETTE.length];
}
