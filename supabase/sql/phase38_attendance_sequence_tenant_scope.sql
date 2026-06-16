-- Phase 38: Scope attendance sequencing to the active tenant and ensure the
-- trigger exists. Andre's clock-out can fail if the sequence check looks at a
-- latest record from another workspace instead of this tenant.

CREATE OR REPLACE FUNCTION public.enforce_attendance_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  last_kind text;
  is_admin_actor boolean;
BEGIN
  is_admin_actor := public.has_role(auth.uid(), 'admin');
  IF is_admin_actor AND NEW.status = 'manual' THEN
    RETURN NEW;
  END IF;

  SELECT kind
  INTO last_kind
  FROM public.attendance_records
  WHERE user_id = NEW.user_id
    AND tenant_id = NEW.tenant_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF NEW.kind = 'check_in' AND last_kind = 'check_in' THEN
    RAISE EXCEPTION 'Already checked in. You must check out before checking in again.' USING ERRCODE = '22023';
  END IF;
  IF NEW.kind = 'check_out' AND (last_kind IS NULL OR last_kind = 'check_out') THEN
    RAISE EXCEPTION 'Cannot check out without an active check-in.' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'enforce_attendance_sequence failed user=% tenant=% kind=%: % (%)', NEW.user_id, NEW.tenant_id, NEW.kind, SQLERRM, SQLSTATE;
  RAISE;
END
$function$;

DROP TRIGGER IF EXISTS enforce_attendance_sequence_trigger ON public.attendance_records;
CREATE TRIGGER enforce_attendance_sequence_trigger
BEFORE INSERT ON public.attendance_records
FOR EACH ROW
EXECUTE FUNCTION public.enforce_attendance_sequence();

NOTIFY pgrst, 'reload schema';