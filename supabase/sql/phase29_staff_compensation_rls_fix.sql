-- phase29_staff_compensation_rls_fix.sql
-- The original phase25 policy required current_tenant_id() to match, which
-- returns NULL when the user's JWT does not carry an active_tenant_id claim
-- (e.g. multi-tenant users). This caused INSERT/UPSERT against
-- staff_compensation to fail with "new row violates row-level security
-- policy". Switch to membership-based checks (same pattern used elsewhere),
-- and keep the license guard for writes.

DROP POLICY IF EXISTS "tenant read staff_compensation" ON public.staff_compensation;
DROP POLICY IF EXISTS "tenant write staff_compensation" ON public.staff_compensation;

CREATE POLICY "tenant read staff_compensation"
  ON public.staff_compensation FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "tenant insert staff_compensation"
  ON public.staff_compensation FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_tenant_member(tenant_id)
    AND public.tenant_license_active(tenant_id)
  );

CREATE POLICY "tenant update staff_compensation"
  ON public.staff_compensation FOR UPDATE
  TO authenticated
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (
    public.is_tenant_member(tenant_id)
    AND public.tenant_license_active(tenant_id)
  );

CREATE POLICY "tenant delete staff_compensation"
  ON public.staff_compensation FOR DELETE
  TO authenticated
  USING (
    public.is_tenant_member(tenant_id)
    AND public.tenant_license_active(tenant_id)
  );
