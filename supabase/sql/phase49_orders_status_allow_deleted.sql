-- Allow 'deleted' status on orders (soft-delete for History Deleted tab).
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('waiting','washing','completed','cancelled','deleted'));
