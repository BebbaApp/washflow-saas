-- =============================================================
-- Phase 4: Tenant management — invitations + helpers.
-- Run in Supabase SQL Editor (idempotent).
-- =============================================================
begin;

-- 1. Invitations table ---------------------------------------
create table if not exists public.tenant_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  tenant_role public.tenant_role not null default 'member',
  token text unique not null default replace(gen_random_uuid()::text,'-',''),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);
create index if not exists idx_invitations_tenant on public.tenant_invitations(tenant_id);
create index if not exists idx_invitations_email on public.tenant_invitations(lower(email));

alter table public.tenant_invitations enable row level security;

-- Owners/admins of the tenant can see and manage invites
drop policy if exists "tenant admins read invites" on public.tenant_invitations;
create policy "tenant admins read invites" on public.tenant_invitations
  for select using (
    public.tenant_has_role(tenant_id, 'owner')
    or public.tenant_has_role(tenant_id, 'admin')
    or public.is_platform_admin(auth.uid())
  );

drop policy if exists "tenant admins write invites" on public.tenant_invitations;
create policy "tenant admins write invites" on public.tenant_invitations
  for all using (
    public.tenant_has_role(tenant_id, 'owner')
    or public.tenant_has_role(tenant_id, 'admin')
    or public.is_platform_admin(auth.uid())
  ) with check (
    public.tenant_has_role(tenant_id, 'owner')
    or public.tenant_has_role(tenant_id, 'admin')
    or public.is_platform_admin(auth.uid())
  );

-- 2. Allow owners to update tenant name (RLS already lets owners update tenants)

-- 3. Owners/admins can remove tenant members; users can self-leave
drop policy if exists "tenant admins remove members" on public.tenant_members;
create policy "tenant admins remove members" on public.tenant_members
  for delete using (
    public.tenant_has_role(tenant_id, 'owner')
    or public.tenant_has_role(tenant_id, 'admin')
    or user_id = auth.uid()
    or public.is_platform_admin(auth.uid())
  );

-- 4. has_membership helper (used by accept flow)
create or replace function public.has_membership(_tenant uuid, _user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.tenant_members where tenant_id=_tenant and user_id=_user);
$$;

commit;
