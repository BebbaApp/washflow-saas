-- Pending discount authorization flow.
-- When a non-privileged user (cashier/washer/driver/supervisor) enters a
-- discount without a manager PIN override, the order is created at the FULL
-- price with `pending_discount` set to a JSON payload describing who asked
-- for it. Admins/managers can approve or reject from the order card.
--
-- Shape of pending_discount:
--   { "amount": 25, "requested_by_id": "uuid", "requested_by_name": "Andi",
--     "requested_at": "2026-07-16T12:00:00Z" }

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pending_discount jsonb NULL;
