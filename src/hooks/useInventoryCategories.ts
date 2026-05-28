import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { INVENTORY_CATEGORIES as DEFAULT_CATEGORIES } from "@/hooks/useInventory";

export interface InventoryCategoryRow {
  id: string;
  name: string;
  sort_order: number;
}

/**
 * Tenant-scoped inventory categories managed in the admin console
 * (`inventory_categories` table). Falls back to the built-in defaults
 * when the tenant has no rows yet.
 */
export function useInventoryCategories() {
  const { tenant } = useTenant();
  const [rows, setRows] = useState<InventoryCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!tenant?.id) {
      setRows(DEFAULT_CATEGORIES.map((name, i) => ({ id: `default-${name}`, name, sort_order: i * 10 })));
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("inventory_categories" as any)
      .select("id, name, sort_order")
      .eq("tenant_id", tenant.id)
      .order("sort_order")
      .order("name");
    if (!error && data && (data as any[]).length > 0) {
      setRows((data as any[]) as InventoryCategoryRow[]);
    } else {
      setRows(DEFAULT_CATEGORIES.map((name, i) => ({ id: `default-${name}`, name, sort_order: i * 10 })));
    }
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!tenant?.id) return;
    const ch = supabase
      .channel(`inventory_categories_${tenant.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "inventory_categories", filter: `tenant_id=eq.${tenant.id}` },
        () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenant?.id, fetchAll]);

  const categories = useMemo(() => rows.map((r) => r.name), [rows]);

  return { rows, categories, loading, refresh: fetchAll };
}
