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
    // No tenant context (e.g. signed out): keep list empty rather than leaking
    // hard-coded defaults from another workspace.
    if (!tenant?.id) {
      setRows([]);
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
    // Strict tenant scope: a freshly-created workspace starts with NO categories
    // until its admin configures them. We no longer fall back to the built-in
    // defaults, which were leaking demo/seed data into every new tenant.
    setRows(!error && data ? ((data as any[]) as InventoryCategoryRow[]) : []);
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
