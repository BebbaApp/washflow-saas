-- phase29_staff_comp_rls_fix.sql
-- Fix: "new row violates row-level security policy for table staff_compensation"
--
-- Root cause: the existing write policy required
--   tenant_id = current_tenant_id()
-- but current_tenant_id() returns NULL when the user's JWT has no
-- active_tenant_id claim AND they belong to more than one tenant, so the
-- upsert from Settings is rejected even for legitimate workspace admins.
--
-- We rewrite the policies to key off tenant_members directly via
-- is_tenant_member(), which is the same pattern other tables use, and keep
-- the license-active guard for writes.

ALTER TABLE public.staff_compensation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant read staff_compensation"  ON public.staff_compensation;
DROP POLICY IF EXISTS "tenant write staff_compensation" ON public.staff_compensation;
DROP POLICY IF EXISTS "staff_compensation read"         ON public.staff_compensation;
DROP POLICY IF EXISTS "staff_compensation write"        ON public.staff_compensation;
DROP POLICY IF EXISTS "staff_compensation insert"       ON public.staff_compensation;
DROP POLICY IF EXISTS "staff_compensation update"       ON public.staff_compensation;
DROP POLICY IF EXISTS "staff_compensation delete"       ON public.staff_compensation;

CREATE POLICY "staff_compensation read"
  ON public.staff_compensation FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "staff_compensation insert"
  ON public.staff_compensation FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_tenant_member(tenant_id)
    AND public.tenant_license_active(tenant_id)
  );

CREATE POLICY "staff_compensation update"
  ON public.staff_compensation FOR UPDATE
  TO authenticated
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (
    public.is_tenant_member(tenant_id)
    AND public.tenant_license_active(tenant_id)
  );

CREATE POLICY "staff_compensation delete"
  ON public.staff_compensation FOR DELETE
  TO authenticated
  USING (public.is_tenant_member(tenant_id));
