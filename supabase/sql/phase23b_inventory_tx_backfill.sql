-- Phase 23b: backfill historical inventory_transactions to measurement units
-- so "last restock" / balance displays match the converted item quantities.
-- Safe to run once after phase23. total_cost is preserved (delta grows by
-- pack_size, unit_cost shrinks by pack_size).

UPDATE public.inventory_transactions t
SET
  delta     = t.delta     * i.pack_size,
  balance   = t.balance   * i.pack_size,
  unit_cost = CASE WHEN t.unit_cost IS NOT NULL AND i.pack_size > 0
                   THEN t.unit_cost / i.pack_size
                   ELSE t.unit_cost END
FROM public.inventory_items i
WHERE t.item_id = i.id
  AND i.pack_size IS NOT NULL
  AND i.pack_size > 1;
