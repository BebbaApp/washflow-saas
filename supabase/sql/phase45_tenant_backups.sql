-- Phase 45: Per-tenant backup / restore / export / health-check
-- Additive only. No existing tables or policies are modified.

-- 1) restored_at marker on tenants so clients wipe local cache after a restore.
alter table public.tenants
  add column if not exists restored_at timestamptz;

-- 2) tenant_backups: append-only snapshots (JSONB or storage-path pointer)
create table if not exists public.tenant_backups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('nightly','manual','pre_restore')),
  row_counts jsonb not null default '{}'::jsonb,
  snapshot jsonb,                     -- inline snapshot when small
  storage_path text,                  -- filled when snapshot spilled to storage
  size_bytes bigint not null default 0,
  checksum text,
  created_by uuid
);
create index if not exists idx_tenant_backups_tenant_created
  on public.tenant_backups(tenant_id, created_at desc);

-- 3) tenant_health_checks
create table if not exists public.tenant_health_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  checked_at timestamptz not null default now(),
  status text not null check (status in ('ok','warning','critical')),
  findings jsonb not null default '[]'::jsonb
);
create index if not exists idx_tenant_health_tenant_checked
  on public.tenant_health_checks(tenant_id, checked_at desc);

-- 4) Grants: service_role only. No anon/authenticated access — everything
-- goes through edge functions using service role.
revoke all on public.tenant_backups from anon, authenticated;
revoke all on public.tenant_health_checks from anon, authenticated;
grant all on public.tenant_backups to service_role;
grant all on public.tenant_health_checks to service_role;

-- 5) RLS: enable + deny-all (no policies means no access).
alter table public.tenant_backups enable row level security;
alter table public.tenant_health_checks enable row level security;

-- 6) Storage bucket for large snapshots. Bucket rows live in storage schema;
-- create only if absent. Private (public=false). Policies below restrict to service_role.
insert into storage.buckets (id, name, public)
values ('tenant-backups','tenant-backups', false)
on conflict (id) do nothing;

-- Storage policies: only service_role can read/write this bucket.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='tenant_backups_service_all') then
    create policy tenant_backups_service_all on storage.objects
      for all to service_role
      using (bucket_id = 'tenant-backups') with check (bucket_id = 'tenant-backups');
  end if;
end $$;
