
-- Fix search_path on next_order_number
CREATE OR REPLACE FUNCTION public.next_order_number()
RETURNS TEXT
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT 'W-' || LPAD(nextval('public.order_number_seq')::TEXT, 3, '0')
$$;

-- Tighten INSERT policy: only staff with a role can insert
DROP POLICY "Staff can insert orders" ON public.orders;
CREATE POLICY "Staff can insert orders" ON public.orders FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator')
  );

-- Tighten UPDATE policy: only staff with a role can update
DROP POLICY "Staff can update orders" ON public.orders;
CREATE POLICY "Staff can update orders" ON public.orders FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator')
  );
