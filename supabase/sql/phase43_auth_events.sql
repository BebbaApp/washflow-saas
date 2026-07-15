-- Phase 43: auth_events — track sign-in / sign-out / signup events per user & tenant.
-- Apply via Supabase → SQL Editor.

create table if not exists public.auth_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text,
  tenant_id uuid,
  kind text not null check (kind in ('sign_in','sign_out','sign_up','password_reset')),
  user_agent text,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists auth_events_tenant_created_idx
  on public.auth_events (tenant_id, created_at desc);
create index if not exists auth_events_user_created_idx
  on public.auth_events (user_id, created_at desc);

grant select, insert on public.auth_events to authenticated;
grant all on public.auth_events to service_role;

alter table public.auth_events enable row level security;

-- Users can always insert / read their own events.
drop policy if exists "auth_events_insert_self" on public.auth_events;
create policy "auth_events_insert_self"
  on public.auth_events for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "auth_events_select_self" on public.auth_events;
create policy "auth_events_select_self"
  on public.auth_events for select to authenticated
  using (user_id = auth.uid());

-- Tenant members can read events scoped to their tenant.
drop policy if exists "auth_events_select_tenant_members" on public.auth_events;
create policy "auth_events_select_tenant_members"
  on public.auth_events for select to authenticated
  using (
    tenant_id is not null
    and public.is_tenant_member(tenant_id)
  );

-- Super admins can read everything.
drop policy if exists "auth_events_select_super_admin" on public.auth_events;
create policy "auth_events_select_super_admin"
  on public.auth_events for select to authenticated
  using (public.is_super_admin(auth.uid()));
