-- Allow admin/supervisor/manager to view all attendance records (managers/supervisors used to be limited)
DROP POLICY IF EXISTS "Users read own attendance" ON public.attendance_records;
CREATE POLICY "Users read own attendance"
ON public.attendance_records
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'supervisor'::app_role)
  OR public.has_role(auth.uid(), 'manager'::app_role)
);

-- Allow admin/supervisor/manager to read all face enrollments (to enumerate enrolled staff for assisted check-in)
DROP POLICY IF EXISTS "Users read own enrollment" ON public.staff_face_enrollments;
CREATE POLICY "Users read own enrollment"
ON public.staff_face_enrollments
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'supervisor'::app_role)
  OR public.has_role(auth.uid(), 'manager'::app_role)
);

-- Allow the attendance sequencing trigger to bypass when an authorized supervisor/manager
-- inserts a verified record on behalf of staff (matching admin behavior).
CREATE OR REPLACE FUNCTION public.enforce_attendance_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  last_kind text;
  is_admin_actor boolean;
  is_assisted_actor boolean;
BEGIN
  is_admin_actor := public.has_role(auth.uid(), 'admin'::app_role);
  is_assisted_actor := is_admin_actor
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role);

  -- Manual overrides bypass sequencing for admins
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
$function$;
