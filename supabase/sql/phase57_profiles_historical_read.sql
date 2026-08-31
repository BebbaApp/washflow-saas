-- Phase 57: Resolve names for former (offboarded) staff.
-- When a staff member is removed, their tenant_members row is deleted, so the
-- "Tenant members read peer profiles" policy no longer matches and the UI falls
-- back to "Unknown" in the Audit Log, Daily Log, and Enrolled Faces lists.
-- This adds a read path for any profile still referenced by historical rows in
-- a tenant the caller belongs to.

create or replace function public.shares_tenant_history(_profile_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members me
    where me.user_id = auth.uid()
      and (
        exists (select 1 from public.attendance_records ar
                 where ar.tenant_id = me.tenant_id and ar.user_id = _profile_user)
        or exists (select 1 from public.attendance_audit_log al
                 where al.tenant_id = me.tenant_id
                   and (al.target_user_id = _profile_user or al.acted_by = _profile_user))
        or exists (select 1 from public.staff_face_enrollments fe
                 where fe.tenant_id = me.tenant_id and fe.user_id = _profile_user)
        or exists (select 1 from public.orders o
                 where o.tenant_id = me.tenant_id and o.created_by = _profile_user)
        or exists (select 1 from public.expenses e
                 where e.tenant_id = me.tenant_id and e.created_by = _profile_user)
        or exists (select 1 from public.staff_pay_adjustments pa
                 where pa.tenant_id = me.tenant_id and pa.worker_id = _profile_user)
        or exists (select 1 from public.membership_audit_log ml
                 where ml.tenant_id = me.tenant_id
                   and (ml.target_user_id = _profile_user or ml.actor_user_id = _profile_user))
        or exists (select 1 from public.shifts s
                 where s.tenant_id = me.tenant_id and s.staff_user_id = _profile_user)
      )
  );
$$;

grant execute on function public.shares_tenant_history(uuid) to authenticated;

drop policy if exists "Tenant members read historical peer profiles" on public.profiles;

create policy "Tenant members read historical peer profiles"
on public.profiles
for select
to authenticated
using (public.shares_tenant_history(profiles.user_id));
