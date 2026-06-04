-- Audit log for admin manual attendance overrides
CREATE TABLE public.attendance_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid,
  target_user_id uuid NOT NULL,
  acted_by uuid NOT NULL,
  action text NOT NULL, -- 'manual_check_in' | 'manual_check_out' | 'override_failed_verification'
  reason text NOT NULL,
  original_score numeric,
  original_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.attendance_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read audit log"
  ON public.attendance_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins insert audit log"
  ON public.attendance_audit_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND acted_by = auth.uid());

-- Sequencing trigger: prevent double check-in / orphan check-out
CREATE OR REPLACE FUNCTION public.enforce_attendance_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_kind text;
BEGIN
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

CREATE TRIGGER attendance_sequence_guard
  BEFORE INSERT ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_sequence();