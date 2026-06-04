-- phase25_staff_compensation.sql
-- Per-tenant payroll settings for each staff member.
-- pay_type: 'salary' | 'wage' | 'hourly'
-- base_rate: monetary value associated with pay_type (e.g. monthly salary,
--            daily wage, or hourly rate).
-- category_rates: optional per-vehicle-category remuneration map, e.g.
--   { "Sedan": 50, "SUV S/Cab": 70, ... }

CREATE TABLE IF NOT EXISTS public.staff_compensation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  user_id uuid NOT NULL,
  pay_type text NOT NULL DEFAULT 'salary' CHECK (pay_type IN ('salary','wage','hourly')),
  base_rate numeric NOT NULL DEFAULT 0,
  category_rates jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (tenant_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_compensation TO authenticated;
GRANT ALL ON public.staff_compensation TO service_role;

ALTER TABLE public.staff_compensation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant read staff_compensation" ON public.staff_compensation;
CREATE POLICY "tenant read staff_compensation"
  ON public.staff_compensation FOR SELECT
  TO authenticated
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "tenant write staff_compensation" ON public.staff_compensation;
CREATE POLICY "tenant write staff_compensation"
  ON public.staff_compensation FOR ALL
  TO authenticated
  USING (tenant_id = current_tenant_id() AND tenant_license_active(tenant_id))
  WITH CHECK (tenant_id = current_tenant_id() AND tenant_license_active(tenant_id));
