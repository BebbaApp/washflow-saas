-- Phase 32: Security hardening from scanner findings
--
-- 1. staff_pins: restrict write policy to admins/owners (was open to any tenant member).
-- 2. user_roles:  restrict write policy to admins/owners (privilege-escalation fix).
-- 3. attendance-selfies storage: scope admin read/delete to the tenant that owns
--    the selfie via staff_face_enrollments.tenant_id (cross-tenant leak fix).
-- 4. Revoke EXECUTE from anon/authenticated on SECURITY DEFINER trigger
--    functions that should never be called via the API.

-- ---------------------------------------------------------------------------
-- 1. staff_pins write hardening
-- ---------------------------------------------------------------------------
drop policy if exists "tenant write staff_pins" on public.staff_pins;
create policy "tenant write staff_pins" on public.staff_pins
  for all
  using (
    tenant_id = public.current_tenant_id()
    and public.tenant_license_active(tenant_id)
    and (
      public.tenant_has_role(tenant_id, 'owner')
      or public.tenant_has_role(tenant_id, 'admin')
      or public.is_platform_admin(auth.uid())
    )
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.tenant_license_active(tenant_id)
    and (
      public.tenant_has_role(tenant_id, 'owner')
      or public.tenant_has_role(tenant_id, 'admin')
      or public.is_platform_admin(auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 2. user_roles write hardening
-- ---------------------------------------------------------------------------
drop policy if exists "tenant write user_roles" on public.user_roles;
create policy "tenant write user_roles" on public.user_roles
  for all
  using (
    tenant_id = public.current_tenant_id()
    and public.tenant_license_active(tenant_id)
    and (
      public.tenant_has_role(tenant_id, 'owner')
      or public.tenant_has_role(tenant_id, 'admin')
      or public.is_platform_admin(auth.uid())
    )
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.tenant_license_active(tenant_id)
    and (
      public.tenant_has_role(tenant_id, 'owner')
      or public.tenant_has_role(tenant_id, 'admin')
      or public.is_platform_admin(auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. attendance-selfies storage: tenant-scoped admin access
-- ---------------------------------------------------------------------------
-- Replace the old admin read/delete policies with ones that verify the
-- admin's current tenant matches the tenant that owns the selfie (looked up
-- via staff_face_enrollments.image_url == storage object name).
drop policy if exists "Users read own selfies" on storage.objects;
drop policy if exists "Admins delete selfies" on storage.objects;
drop policy if exists "Admins read selfies" on storage.objects;

-- Owner reads own selfie (path prefix = user id)
create policy "Users read own selfies"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attendance-selfies'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- Admin of the owning tenant can read
create policy "Admins read tenant selfies"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attendance-selfies'
    and exists (
      select 1
      from public.staff_face_enrollments sfe
      where sfe.image_url = storage.objects.name
        and sfe.tenant_id = public.current_tenant_id()
        and (
          public.tenant_has_role(sfe.tenant_id, 'owner')
          or public.tenant_has_role(sfe.tenant_id, 'admin')
          or public.is_platform_admin(auth.uid())
        )
    )
  );

-- Admin of the owning tenant can delete
create policy "Admins delete tenant selfies"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'attendance-selfies'
    and exists (
      select 1
      from public.staff_face_enrollments sfe
      where sfe.image_url = storage.objects.name
        and sfe.tenant_id = public.current_tenant_id()
        and (
          public.tenant_has_role(sfe.tenant_id, 'owner')
          or public.tenant_has_role(sfe.tenant_id, 'admin')
          or public.is_platform_admin(auth.uid())
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Lock down SECURITY DEFINER trigger functions (no API exposure)
-- ---------------------------------------------------------------------------
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.handle_new_user_tenant() from anon, authenticated, public;
revoke execute on function public.assign_default_role_on_confirm() from anon, authenticated, public;
revoke execute on function public.enforce_attendance_sequence() from anon, authenticated, public;
revoke execute on function public.enforce_orders_update_permissions() from anon, authenticated, public;
revoke execute on function public.log_member_change() from anon, authenticated, public;
revoke execute on function public.log_tenant_update() from anon, authenticated, public;
revoke execute on function public.log_platform_admin_change() from anon, authenticated, public;
revoke execute on function public.log_receipt_settings_update() from anon, authenticated, public;
revoke execute on function public.seed_tenant_receipt_settings() from anon, authenticated, public;
revoke execute on function public.update_updated_at_column() from anon, authenticated, public;
