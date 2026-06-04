CREATE OR REPLACE FUNCTION public.enforce_attendance_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_kind text;
  is_admin_actor boolean;
BEGIN
  is_admin_actor := public.has_role(auth.uid(), 'admin'::app_role);

  -- Admin manual overrides bypass sequencing
  IF is_admin_actor AND NEW.status = 'manual' THEN
    RETURN NEW;
  END IF;

  SELECT kind INTO last_kind
    FROM public.attendance_records
   WHERE user_id = NEW.user_id
   ORDER BY created_at DESC
   LIMIT 1;

  IF NEW.kind = 'check_in' AND last_kind = 'check_in' THEN
    RAISE EXCEPTION 'Already checked in. You must check out before checking in again.'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.kind = 'check_out' AND (last_kind IS NULL OR last_kind = 'check_out') THEN
    RAISE EXCEPTION 'Cannot check out without an active check-in.'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;