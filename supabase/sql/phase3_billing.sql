-- =============================================================
-- Phase 3: Allow platform admins to manage plan pricing.
-- Run in Supabase SQL Editor.
-- =============================================================
begin;

drop policy if exists "platform admins write plans" on public.plans;
create policy "platform admins write plans" on public.plans for all
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

commit;
