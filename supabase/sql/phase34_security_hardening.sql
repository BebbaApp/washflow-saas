-- Phase 34: Security hardening from scanner findings.
--
-- Restricts RLS policies on sensitive tables to the `authenticated` role
-- (previously implicit `public`, which includes `anon`), tightens
-- staff_compensation to admins/owners only, and adds an UPDATE policy on
-- the attendance-selfies storage bucket.
--
-- Idempotent: safely re-runnable.

-- Helper to recreate tenant-scoped read/write policies restricted to authenticated.
do $$
declare
  t text;
  read_tables text[] := array[
    'attendance_records','attendance_audit_log','customers','expenses',
    'loyalty_transactions','orders','shifts','shift_templates','time_off_requests'
  ];
  write_tables text[] := array[
    'attendance_records','customers','expenses','loyalty_transactions',
    'orders','shifts','shift_templates','time_off_requests'
  ];
begin
  foreach t in array read_tables loop
    execute format('drop policy if exists "tenant read %1$s" on public.%1$s', t);
    execute format(
      'create policy "tenant read %1$s" on public.%1$s for select to authenticated using (tenant_id = public.current_tenant_id() and public.is_tenant_member(tenant_id))',
      t
    );
  end loop;

  foreach t in array write_tables loop
    execute format('drop policy if exists "tenant write %1$s" on public.%1$s', t);
    execute format(
      'create policy "tenant write %1$s" on public.%1$s for all to authenticated using (tenant_id = public.current_tenant_id() and public.is_tenant_member(tenant_id) and public.tenant_license_active(tenant_id)) with check (tenant_id = public.current_tenant_id() and public.is_tenant_member(tenant_id) and public.tenant_license_active(tenant_id))',
      t
    );
  end loop;
end $$;

-- attendance_audit_log: typically insert-only via triggers; ensure no public write policy.
drop policy if exists "tenant write attendance_audit_log" on public.attendance_audit_log;

-- ---------------------------------------------------------------------------
-- services: scope writes to authenticated tenant members with admin/owner role
-- ---------------------------------------------------------------------------
drop policy if exists "tenant read services"  on public.services;
drop policy if exists "tenant write services" on public.services;

create policy "tenant read services" on public.services
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_tenant_member(tenant_id));

create policy "tenant write services" on public.services
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
-- staff_compensation: lock to admins/owners only (sensitive payroll data)
-- ---------------------------------------------------------------------------
drop policy if exists "staff_compensation read"   on public.staff_compensation;
drop policy if exists "staff_compensation insert" on public.staff_compensation;
drop policy if exists "staff_compensation update" on public.staff_compensation;
drop policy if exists "staff_compensation delete" on public.staff_compensation;

create policy "staff_compensation read" on public.staff_compensation
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id) and (
      public.tenant_has_role(tenant_id, 'owner')
      or public.tenant_has_role(tenant_id, 'admin')
      or public.is_platform_admin(auth.uid())
    )
  );

create policy "staff_compensation insert" on public.staff_compensation
  for insert to authenticated
  with check (
    public.is_tenant_member(tenant_id)
    and public.tenant_license_active(tenant_id)
    and (
      public.tenant_has_role(tenant_id, 'owner')
      or public.tenant_has_role(tenant_id, 'admin')
      or public.is_platform_admin(auth.uid())
    )
  );

create policy "staff_compensation update" on public.staff_compensation
  for update to authenticated
  using (
    public.is_tenant_member(tenant_id) and (
      public.tenant_has_role(tenant_id, 'owner')
      or public.tenant_has_role(tenant_id, 'admin')
      or public.is_platform_admin(auth.uid())
    )
  )
  with check (
    public.is_tenant_member(tenant_id)
    and public.tenant_license_active(tenant_id)
    and (
      public.tenant_has_role(tenant_id, 'owner')
      or public.tenant_has_role(tenant_id, 'admin')
      or public.is_platform_admin(auth.uid())
    )
  );

create policy "staff_compensation delete" on public.staff_compensation
  for delete to authenticated
  using (
    public.is_tenant_member(tenant_id) and (
      public.tenant_has_role(tenant_id, 'owner')
      or public.tenant_has_role(tenant_id, 'admin')
      or public.is_platform_admin(auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- attendance-selfies storage: add UPDATE policy (owner or tenant admin)
-- ---------------------------------------------------------------------------
drop policy if exists "Users update own selfies" on storage.objects;
drop policy if exists "Admins update tenant selfies" on storage.objects;

create policy "Users update own selfies"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'attendance-selfies'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'attendance-selfies'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "Admins update tenant selfies"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'attendance-selfies'
    and exists (
      select 1 from public.staff_face_enrollments sfe
      where sfe.image_url = storage.objects.name
        and sfe.tenant_id = public.current_tenant_id()
        and (
          public.tenant_has_role(sfe.tenant_id, 'owner')
          or public.tenant_has_role(sfe.tenant_id, 'admin')
          or public.is_platform_admin(auth.uid())
        )
    )
  )
  with check (
    bucket_id = 'attendance-selfies'
    and exists (
      select 1 from public.staff_face_enrollments sfe
      where sfe.image_url = storage.objects.name
        and sfe.tenant_id = public.current_tenant_id()
    )
  );
