import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";

export interface InventoryCategoryRow {
  id: string;
  name: string;
  sort_order: number;
}

/**
 * Inventory categories visible to the current workspace:
 *   - global rows (tenant_id IS NULL) managed in the Platform Console
 *   - any tenant-specific rows (legacy / custom requests)
 */
export function useInventoryCategories() {
  const { tenant } = useTenant();
  const [rows, setRows] = useState<InventoryCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("inventory_categories" as any)
      .select("id, name, sort_order, tenant_id")
      .order("sort_order")
      .order("name");
    if (tenant?.id) {
      query = query.or(`tenant_id.is.null,tenant_id.eq.${tenant.id}`);
    } else {
      query = query.is("tenant_id", null);
    }
    const { data, error } = await query;
    setRows(!error && data ? ((data as any[]) as InventoryCategoryRow[]) : []);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const ch = supabase
      .channel(`inventory_categories_${tenant?.id ?? "global"}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "inventory_categories" },
        () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenant?.id, fetchAll]);

  const categories = useMemo(() => rows.map((r) => r.name), [rows]);

  return { rows, categories, loading, refresh: fetchAll };
}
