-- phase24_staff_active_status.sql
-- Per-tenant active/inactive flag for staff members.
-- A missing row means the staff member is ACTIVE by default.

CREATE TABLE IF NOT EXISTS public.staff_active_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  user_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_active_status TO authenticated;
GRANT ALL ON public.staff_active_status TO service_role;

ALTER TABLE public.staff_active_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant read staff_active_status" ON public.staff_active_status;
CREATE POLICY "tenant read staff_active_status"
  ON public.staff_active_status FOR SELECT
  TO authenticated
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "tenant write staff_active_status" ON public.staff_active_status;
CREATE POLICY "tenant write staff_active_status"
  ON public.staff_active_status FOR ALL
  TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_license_active(tenant_id))
  WITH CHECK (tenant_id = current_tenant_id() AND tenant_license_active(tenant_id));
