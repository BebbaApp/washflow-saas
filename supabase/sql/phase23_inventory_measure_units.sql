-- Phase 23: store inventory quantity in measurement units (not packs).
-- Display becomes simply "<qty><unit>" (e.g. "5L") and restocks add in
-- measurement units. Convert existing rows: multiply qty/threshold by pack_size
-- and divide unit_cost so total cost stays the same.

UPDATE public.inventory_items
SET
  quantity        = quantity        * pack_size,
  threshold       = threshold       * pack_size,
  recommended_min = CASE WHEN recommended_min IS NOT NULL THEN recommended_min * pack_size END,
  recommended_max = CASE WHEN recommended_max IS NOT NULL THEN recommended_max * pack_size END,
  unit_cost       = CASE WHEN pack_size > 0 THEN unit_cost / pack_size ELSE unit_cost END
WHERE pack_size IS NOT NULL AND pack_size > 1;

-- Convert past transactions for items that had pack_size > 1 so historical
-- "last restock" / balance entries display in measurement units. total_cost
-- stays the same (delta * unit_cost ratio preserved).
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
