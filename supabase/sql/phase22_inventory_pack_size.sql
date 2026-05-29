-- Phase 22: per-item pack size (e.g. "each = 5L bottle"). Quantity counts units,
-- not the contained measurement, so expense = unit_cost × quantity stays correct.
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS pack_size numeric;
