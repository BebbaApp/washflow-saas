-- Phase 44: allow platform/super admins to approve tenant time-off requests.
--
-- The app lets platform/super admins switch into any workspace and see staff
-- time-off requests, but the existing write policy only allowed tenant
-- members. PostgREST therefore returned a successful UPDATE with zero rows,
-- leaving approvals queued locally with "No remote time_off_requests row was
-- updated".

DROP POLICY IF EXISTS "tenant write time_off_requests" ON public.time_off_requests;

CREATE POLICY "tenant write time_off_requests"
  ON public.time_off_requests
  FOR ALL
  TO authenticated
  USING (
    public.tenant_license_active(tenant_id)
    AND (
      (tenant_id = public.current_tenant_id() AND public.is_tenant_member(tenant_id))
      OR public.is_platform_admin(auth.uid())
      OR public.is_super_admin(auth.uid())
    )
  )
  WITH CHECK (
    public.tenant_license_active(tenant_id)
    AND (
      (tenant_id = public.current_tenant_id() AND public.is_tenant_member(tenant_id))
      OR public.is_platform_admin(auth.uid())
      OR public.is_super_admin(auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';