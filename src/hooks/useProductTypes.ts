import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { InventoryPreset } from "@/lib/inventoryPresets";

export interface ProductTypeRow {
  id: string;
  name: string;
  category: string;
  unit: string;
  recommended_min: number;
  recommended_max: number;
  description: string | null;
  sort_order: number;
}

/**
 * Global product-type catalog (the "Product Types" tab in the Platform
 * Console). Replaces the previously hard-coded INVENTORY_PRESETS list and
 * is uniform across every tenant — only platform admins can edit it.
 */
export function useProductTypes() {
  const [rows, setRows] = useState<ProductTypeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("product_types" as any)
      .select("id, name, category, unit, recommended_min, recommended_max, description, sort_order")
      .order("sort_order")
      .order("name");
    setRows(!error && data ? ((data as any[]) as ProductTypeRow[]) : []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const ch = supabase
      .channel("product_types_global")
      .on("postgres_changes", { event: "*", schema: "public", table: "product_types" }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchAll]);

  /** Adapt rows to the legacy InventoryPreset shape used by InventoryPage. */
  const presets = useMemo<InventoryPreset[]>(
    () => rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      unit: r.unit,
      recommendedMin: Number(r.recommended_min) || 0,
      recommendedMax: Number(r.recommended_max) || 0,
      description: r.description ?? undefined,
    })),
    [rows]
  );

  return { rows, presets, loading, refresh: fetchAll };
}
