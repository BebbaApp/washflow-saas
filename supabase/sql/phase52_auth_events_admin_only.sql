-- Phase 52: Restrict tenant-wide auth_events visibility to owners/admins.
-- Previously any tenant member could read every colleague's login email, IP and user agent.
-- Apply via Supabase → SQL Editor.

drop policy if exists "auth_events_select_tenant_members" on public.auth_events;

create policy "auth_events_select_tenant_admins"
  on public.auth_events for select to authenticated
  using (
    tenant_id is not null
    and (
      public.tenant_has_role(tenant_id, 'owner'::public.tenant_role)
      or public.tenant_has_role(tenant_id, 'admin'::public.tenant_role)
      or public.is_platform_admin(auth.uid())
    )
  );

-- Users can still read their own events via "auth_events_select_self".
