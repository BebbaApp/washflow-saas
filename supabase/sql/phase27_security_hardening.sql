-- Phase 27: Security hardening fixes
-- Addresses scanner findings:
--  * current_tenant_id() ambiguous fallback for multi-tenant users
--  * staff_pins pin_hash readable by all tenant members
--  * Sensitive tables broadcast via Supabase Realtime (no row-level filtering)
--  * Storage policies using unscoped has_role() for attendance-selfies
--  * SECURITY DEFINER functions executable directly via PostgREST

-- 1. current_tenant_id(): only fall back when user has EXACTLY one tenant.
create or replace function public.current_tenant_id()
returns uuid
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  claim_tenant uuid;
  member_tenant uuid;
  member_count int;
begin
  begin
    claim_tenant := nullif(
      (auth.jwt() -> 'app_metadata' ->> 'active_tenant_id'), ''
    )::uuid;
  exception when others then claim_tenant := null; end;
  if claim_tenant is not null then return claim_tenant; end if;

  select count(*) into member_count
  from (
    select 1 from public.tenant_members
    where user_id = auth.uid()
    limit 2
  ) s;

  if member_count = 1 then
    select tenant_id into member_tenant
    from public.tenant_members
    where user_id = auth.uid()
    limit 1;
    return member_tenant;
  end if;

  return null;
end $function$;

-- 2. staff_pins: restrict SELECT to tenant admins/owners (pin_hash is sensitive).
drop policy if exists "tenant read staff_pins" on public.staff_pins;
create policy "tenant admins read staff_pins"
  on public.staff_pins for select
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.tenant_has_role(tenant_id, 'owner'::tenant_role)
      or public.tenant_has_role(tenant_id, 'admin'::tenant_role)
      or public.is_platform_admin(auth.uid())
    )
  );

-- 3. Drop sensitive tables from realtime publication. Realtime has no
--    row-level filtering, so subscribers would receive biometric URLs,
--    invitation tokens, admin emails, and billing data across tenants.
do $$
declare
  t text;
  tables text[] := array[
    'staff_face_enrollments',
    'tenant_invitations',
    'membership_audit_log',
    'staff_pins',
    'attendance_audit_log',
    'subscriptions',
    'invoices',
    'license_events',
    'platform_settings'
  ];
begin
  foreach t in array tables loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;

-- 4. attendance-selfies storage: replace global has_role() check with
--    tenant-scoped admin lookup keyed on the selfie owner's tenant.
drop policy if exists "Users read own selfies" on storage.objects;
drop policy if exists "Admins delete selfies" on storage.objects;

create policy "Users read own selfies"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attendance-selfies' and (
      auth.uid()::text = (storage.foldername(name))[1]
      or exists (
        select 1
        from public.user_roles ur_admin
        join public.tenant_members tm_target
          on tm_target.tenant_id = ur_admin.tenant_id
        where ur_admin.user_id = auth.uid()
          and ur_admin.role = 'admin'::public.app_role
          and tm_target.user_id::text = (storage.foldername(name))[1]
      )
    )
  );

create policy "Admins delete selfies"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attendance-selfies' and exists (
      select 1
      from public.user_roles ur_admin
      join public.tenant_members tm_target
        on tm_target.tenant_id = ur_admin.tenant_id
      where ur_admin.user_id = auth.uid()
        and ur_admin.role = 'admin'::public.app_role
        and tm_target.user_id::text = (storage.foldername(name))[1]
      )
  );

-- 5. Revoke direct EXECUTE on SECURITY DEFINER helpers. They are still
--    called transparently from RLS policies / other definer functions,
--    but should not be a callable PostgREST RPC surface.
revoke execute on function public.current_tenant_id() from anon, authenticated, public;
revoke execute on function public.is_tenant_member(uuid) from anon, authenticated, public;
revoke execute on function public.tenant_has_role(uuid, tenant_role) from anon, authenticated, public;
revoke execute on function public.tenant_license_active(uuid) from anon, authenticated, public;
revoke execute on function public.is_platform_admin(uuid) from anon, authenticated, public;
revoke execute on function public.is_super_admin(uuid) from anon, authenticated, public;
revoke execute on function public.has_role(uuid, app_role) from anon, authenticated, public;
revoke execute on function public.has_membership(uuid, uuid) from anon, authenticated, public;
revoke execute on function public.get_user_role(uuid) from anon, authenticated, public;

-- next_order_number is invoked as an RPC by the app — keep it callable
-- by authenticated users only (revoke from anon).
revoke execute on function public.next_order_number() from anon, public;
grant execute on function public.next_order_number() to authenticated;
