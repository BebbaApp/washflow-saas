import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { EXPENSE_CATEGORIES as DEFAULT_CATEGORIES } from "@/hooks/useExpenses";

/**
 * Loads tenant-scoped expense categories managed in the admin console
 * (`expense_categories` table). Falls back to the built-in defaults when
 * the tenant has not configured any categories yet.
 */
export function useExpenseCategories() {
  const { tenant } = useTenant();
  const [categories, setCategories] = useState<string[]>([...DEFAULT_CATEGORIES]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!tenant?.id) {
      setCategories([...DEFAULT_CATEGORIES]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("expense_categories" as any)
      .select("name, sort_order")
      .eq("tenant_id", tenant.id)
      .order("sort_order")
      .order("name");
    if (!error && data && (data as any[]).length > 0) {
      setCategories((data as any[]).map((r) => String(r.name)));
    } else {
      setCategories([...DEFAULT_CATEGORIES]);
    }
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!tenant?.id) return;
    const ch = supabase
      .channel(`expense_categories_${tenant.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "expense_categories", filter: `tenant_id=eq.${tenant.id}` },
        () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenant?.id, fetchAll]);

  return { categories, loading, refresh: fetchAll };
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
