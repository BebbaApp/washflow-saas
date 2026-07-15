-- Add per-order discount amount (Rand value deducted from the service price).
-- `service_price` stores the FINAL (net) price the customer paid so existing
-- revenue calculations stay correct; `discount` is informational for display.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS discount numeric(12,2) NOT NULL DEFAULT 0;
