-- Phase 31: Allow platform/super admins to read all profiles so the
-- attendance/enrollment UI can resolve staff names (instead of "Unknown")
-- for tenants they aren't a member of. Also helps realtime SELECT-policy
-- checks fire for face enrollment rows pushed to platform-admin sessions.

drop policy if exists "Platform admins read all profiles" on public.profiles;

create policy "Platform admins read all profiles"
on public.profiles
for select
to authenticated
using (
  public.is_platform_admin(auth.uid())
  or public.is_super_admin(auth.uid())
);
