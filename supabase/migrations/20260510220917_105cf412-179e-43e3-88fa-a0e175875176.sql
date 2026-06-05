-- Prevent duplicate auto-redemptions under race conditions.
-- Partial unique index because order_id is nullable for manual redemptions
-- (those are still rate-limited client-side via the points balance check).
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_txn_unique_order_redeem
  ON public.loyalty_transactions (customer_id, order_id, type)
  WHERE order_id IS NOT NULL;