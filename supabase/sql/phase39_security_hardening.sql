-- Phase 39: Security scanner hardening
--
-- Addresses findings:
--   * customers / orders / staff_pins / staff_face_enrollments SELECT policies
--     applied to {public} (anon included). Restrict to {authenticated}.
--   * staff_compensation had broad "tenant insert/update/delete" policies that
--     overrode the stricter owner/admin policies (PERMISSIVE OR). Drop them.
--   * staff_pins broad "tenant read" overrode admin-only SELECT. Drop it.
--   * attendance_records / attendance_audit_log policies applied to {public}.
--   * receipt_settings broad "tenant write" overrode admin-only write. Drop it.
--   * membership_audit_log INSERT policy added (defensive — triggers run as
--     SECURITY DEFINER so they bypass RLS, but this protects future changes).
--
-- Idempotent.

-- ---------------------------------------------------------------------------
-- 1. customers — restrict SELECT/WRITE to authenticated
-- ---------------------------------------------------------------------------
drop policy if exists "tenant read customers"  on public.customers;
drop policy if exists "tenant write customers" on public.customers;

create policy "tenant read customers" on public.customers
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_tenant_member(tenant_id));

create policy "tenant write customers" on public.customers
  for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.is_tenant_member(tenant_id)
    and public.tenant_license_active(tenant_id)
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.is_tenant_member(tenant_id)
    and public.tenant_license_active(tenant_id)
  );

-- ---------------------------------------------------------------------------
-- 2. orders — restrict SELECT/WRITE to authenticated
-- ---------------------------------------------------------------------------
drop policy if exists "tenant read orders"  on public.orders;
drop policy if exists "tenant write orders" on public.orders;

create policy "tenant read orders" on public.orders
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_tenant_member(tenant_id));

create policy "tenant write orders" on public.orders
  for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.is_tenant_member(tenant_id)
    and public.tenant_license_active(tenant_id)
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.is_tenant_member(tenant_id)
    and public.tenant_license_active(tenant_id)
  );

-- ---------------------------------------------------------------------------
-- 3. staff_pins — drop the broad "tenant read"; admins-only SELECT remains
-- ---------------------------------------------------------------------------
drop policy if exists "tenant read staff_pins" on public.staff_pins;
-- Ensure the admin-only SELECT policy exists and is scoped to authenticated.
drop policy if exists "tenant admins read staff_pins" on public.staff_pins;
create policy "tenant admins read staff_pins" on public.staff_pins
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.tenant_has_role(tenant_id, 'owner')
      or public.tenant_has_role(tenant_id, 'admin')
      or public.is_platform_admin(auth.uid())
    )
  );

-- Re-assert tightened write policy on authenticated (was already admin-only).
drop policy if exists "tenant write staff_pins" on public.staff_pins;
create policy "tenant write staff_pins" on public.staff_pins
  for all to authenticated
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
-- 4. staff_face_enrollments — restrict SELECT to authenticated
-- ---------------------------------------------------------------------------
drop policy if exists "tenant read staff_face_enrollments" on public.staff_face_enrollments;
create policy "tenant read staff_face_enrollments" on public.staff_face_enrollments
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_tenant_member(tenant_id));

-- ---------------------------------------------------------------------------
-- 5. attendance_records / attendance_audit_log — restrict to authenticated
-- ---------------------------------------------------------------------------
drop policy if exists "tenant read attendance_records"  on public.attendance_records;
drop policy if exists "tenant write attendance_records" on public.attendance_records;

create policy "tenant read attendance_records" on public.attendance_records
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_tenant_member(tenant_id));

create policy "tenant write attendance_records" on public.attendance_records
  for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.is_tenant_member(tenant_id)
    and public.tenant_license_active(tenant_id)
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.is_tenant_member(tenant_id)
    and public.tenant_license_active(tenant_id)
  );

drop policy if exists "tenant read attendance_audit_log" on public.attendance_audit_log;
create policy "tenant read attendance_audit_log" on public.attendance_audit_log
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_tenant_member(tenant_id));

-- ---------------------------------------------------------------------------
-- 6. staff_compensation — drop the broad "tenant insert/update/delete"
--    policies; rely solely on owner/admin-scoped policies from phase 34.
-- ---------------------------------------------------------------------------
drop policy if exists "tenant insert staff_compensation" on public.staff_compensation;
drop policy if exists "tenant update staff_compensation" on public.staff_compensation;
drop policy if exists "tenant delete staff_compensation" on public.staff_compensation;
drop policy if exists "tenant read staff_compensation"   on public.staff_compensation;
drop policy if exists "tenant write staff_compensation"  on public.staff_compensation;

-- ---------------------------------------------------------------------------
-- 7. receipt_settings — drop the broad "tenant write" so only the
--    admin/owner-scoped policies apply.
-- ---------------------------------------------------------------------------
drop policy if exists "tenant write receipt_settings" on public.receipt_settings;
drop policy if exists "tenant read receipt_settings"  on public.receipt_settings;

-- ---------------------------------------------------------------------------
-- 8. membership_audit_log — explicit INSERT policy (defensive).
--    Triggers run as SECURITY DEFINER so they bypass RLS, but adding a
--    service-role/platform-admin INSERT policy makes intent explicit.
-- ---------------------------------------------------------------------------
drop policy if exists "audit log service insert" on public.membership_audit_log;
create policy "audit log service insert" on public.membership_audit_log
  for insert to authenticated
  with check (
    public.is_platform_admin(auth.uid())
    or public.is_tenant_member(tenant_id)
  );
