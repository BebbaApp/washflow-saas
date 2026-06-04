
-- Update RLS policies to use supervisor instead of operator
-- Also add new roles where staff access is needed

-- customers table
DROP POLICY IF EXISTS "Staff can insert customers" ON public.customers;
CREATE POLICY "Staff can insert customers" ON public.customers FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'washer'::app_role) OR has_role(auth.uid(), 'driver'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
);

DROP POLICY IF EXISTS "Staff can read customers" ON public.customers;
CREATE POLICY "Staff can read customers" ON public.customers FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'washer'::app_role) OR has_role(auth.uid(), 'driver'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
);

DROP POLICY IF EXISTS "Staff can update customers" ON public.customers;
CREATE POLICY "Staff can update customers" ON public.customers FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
);

-- orders table
DROP POLICY IF EXISTS "Staff can insert orders" ON public.orders;
CREATE POLICY "Staff can insert orders" ON public.orders FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'washer'::app_role) OR has_role(auth.uid(), 'driver'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
);

DROP POLICY IF EXISTS "Staff can read orders" ON public.orders;
CREATE POLICY "Staff can read orders" ON public.orders FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Staff can update orders" ON public.orders;
CREATE POLICY "Staff can update orders" ON public.orders FOR UPDATE
USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'washer'::app_role) OR has_role(auth.uid(), 'driver'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
);

-- loyalty_transactions
DROP POLICY IF EXISTS "Staff can insert loyalty txns" ON public.loyalty_transactions;
CREATE POLICY "Staff can insert loyalty txns" ON public.loyalty_transactions FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
);

DROP POLICY IF EXISTS "Staff can read loyalty txns" ON public.loyalty_transactions;
CREATE POLICY "Staff can read loyalty txns" ON public.loyalty_transactions FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'washer'::app_role) OR has_role(auth.uid(), 'driver'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
);

-- shifts
DROP POLICY IF EXISTS "Staff can read all shifts" ON public.shifts;
CREATE POLICY "Staff can read all shifts" ON public.shifts FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'washer'::app_role) OR has_role(auth.uid(), 'driver'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
);

-- shift_templates
DROP POLICY IF EXISTS "Staff can read shift templates" ON public.shift_templates;
CREATE POLICY "Staff can read shift templates" ON public.shift_templates FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'cashier'::app_role) OR has_role(auth.uid(), 'washer'::app_role) OR has_role(auth.uid(), 'driver'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
);

-- time_off_requests
DROP POLICY IF EXISTS "Staff can read own time off" ON public.time_off_requests;
CREATE POLICY "Staff can read own time off" ON public.time_off_requests FOR SELECT
USING (
  (auth.uid() = staff_user_id) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
);

-- user_roles: allow all staff to read own role (keep existing)
-- No changes needed for user_roles policies

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';
