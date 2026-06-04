-- Server-side guard for orders updates: prevent field staff from modifying
-- restricted columns or cancelling orders, regardless of UI gating.
CREATE OR REPLACE FUNCTION public.enforce_orders_update_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  is_admin boolean := public.has_role(uid, 'admin'::app_role);
  is_supervisor boolean := public.has_role(uid, 'supervisor'::app_role);
  is_manager boolean := public.has_role(uid, 'manager'::app_role);
  is_cashier boolean := public.has_role(uid, 'cashier'::app_role);
  is_washer boolean := public.has_role(uid, 'washer'::app_role);
  is_driver boolean := public.has_role(uid, 'driver'::app_role);
  can_cancel boolean := is_admin OR is_supervisor OR is_manager OR is_cashier;
  can_edit_notes boolean := is_admin OR is_supervisor OR is_manager OR is_cashier;
BEGIN
  -- Admins bypass all restrictions
  IF is_admin THEN
    RETURN NEW;
  END IF;

  -- Field staff: only allowed to advance status (in_progress / completed) and
  -- set completed_at / wait_minutes. Block edits to all other business fields.
  IF (is_washer OR is_driver) AND NOT (is_supervisor OR is_manager OR is_cashier) THEN
    IF NEW.customer IS DISTINCT FROM OLD.customer
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.customer_phone IS DISTINCT FROM OLD.customer_phone
       OR NEW.plate IS DISTINCT FROM OLD.plate
       OR NEW.vehicle IS DISTINCT FROM OLD.vehicle
       OR NEW.service IS DISTINCT FROM OLD.service
       OR NEW.service_price IS DISTINCT FROM OLD.service_price
       OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.order_number IS DISTINCT FROM OLD.order_number
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Field staff cannot modify order details (only status/completion).'
        USING ERRCODE = '42501';
    END IF;
    -- Field staff cannot cancel orders
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'cancelled' THEN
      RAISE EXCEPTION 'Field staff cannot cancel orders.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- All other staff: gate cancellations and notes edits explicitly.
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'cancelled' AND NOT can_cancel THEN
    RAISE EXCEPTION 'You do not have permission to cancel orders.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.notes IS DISTINCT FROM OLD.notes AND NOT can_edit_notes THEN
    RAISE EXCEPTION 'You do not have permission to edit order notes.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_orders_update_permissions_trg ON public.orders;
CREATE TRIGGER enforce_orders_update_permissions_trg
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_orders_update_permissions();