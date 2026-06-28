-- Phase 40: switch generated order numbers to the WO-XXX format used in the UI.
-- Both online and offline-created orders are now reconciled to "WO-<seq>".
CREATE OR REPLACE FUNCTION public.next_order_number()
RETURNS text
LANGUAGE sql
SET search_path TO 'public'
AS $function$
  SELECT 'WO-' || LPAD(nextval('public.order_number_seq')::TEXT, 3, '0')
$function$;

GRANT EXECUTE ON FUNCTION public.next_order_number() TO authenticated;
