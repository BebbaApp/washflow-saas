-- =============================================================
-- Phase 10: Tenant-scoped role permissions matrix.
-- Run in Supabase SQL Editor (idempotent).
-- =============================================================
begin;

create table if not exists public.role_permissions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  matrix jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.role_permissions enable row level security;

drop policy if exists "members read role_permissions" on public.role_permissions;
create policy "members read role_permissions" on public.role_permissions
  for select using (
    public.is_tenant_member(tenant_id) or public.is_platform_admin(auth.uid())
  );

drop policy if exists "admins write role_permissions" on public.role_permissions;
create policy "admins write role_permissions" on public.role_permissions
  for all using (
    public.tenant_has_role(tenant_id, 'owner')
    or public.tenant_has_role(tenant_id, 'admin')
    or public.is_platform_admin(auth.uid())
  ) with check (
    public.tenant_has_role(tenant_id, 'owner')
    or public.tenant_has_role(tenant_id, 'admin')
    or public.is_platform_admin(auth.uid())
  );

commit;
