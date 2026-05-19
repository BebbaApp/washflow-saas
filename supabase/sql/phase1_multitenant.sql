-- =============================================================
-- Phase 1: Multi-tenant foundation
-- Run this in Supabase SQL Editor (one shot).
-- Idempotent where reasonable; safe to re-run.
-- =============================================================

begin;

-- 1. ENUMS -----------------------------------------------------
do $$ begin
  create type public.tenant_status as enum
    ('trialing','active','past_due','suspended','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tenant_role as enum ('owner','admin','member');
exception when duplicate_object then null; end $$;

-- 2. CORE TABLES ----------------------------------------------
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  price_monthly_cents integer not null default 0,
  max_users integer,
  features jsonb not null default '{}'::jsonb,
  stripe_price_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  status public.tenant_status not null default 'trialing',
  plan_id uuid references public.plans(id),
  stripe_customer_id text unique,
  trial_ends_at timestamptz not null default (now() + interval '30 days'),
  current_period_end timestamptz,
  grace_period_ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_role public.tenant_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index if not exists idx_tenant_members_user on public.tenant_members(user_id);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid references public.plans(id),
  stripe_sub_id text unique,
  status text not null,
  current_period_end timestamptz,
  cancel_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  stripe_invoice_id text unique,
  amount_cents integer not null default 0,
  currency text not null default 'usd',
  status text not null,
  due_date timestamptz,
  paid_at timestamptz,
  hosted_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.license_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 3. SECURITY DEFINER HELPERS ---------------------------------
create or replace function public.is_platform_admin(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.platform_admins where user_id = _uid);
$$;

create or replace function public.current_tenant_id()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  claim_tenant uuid;
  member_tenant uuid;
begin
  -- Try JWT claim first (set by switch-tenant edge function in app_metadata)
  begin
    claim_tenant := nullif(
      (auth.jwt() -> 'app_metadata' ->> 'active_tenant_id'), ''
    )::uuid;
  exception when others then claim_tenant := null; end;
  if claim_tenant is not null then return claim_tenant; end if;

  -- Fallback: user belongs to exactly one tenant
  select tenant_id into member_tenant
  from public.tenant_members
  where user_id = auth.uid()
  limit 2;
  return member_tenant;
end $$;

create or replace function public.is_tenant_member(_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.tenant_members
    where tenant_id = _tenant and user_id = auth.uid()
  );
$$;

create or replace function public.tenant_has_role(_tenant uuid, _role public.tenant_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.tenant_members
    where tenant_id = _tenant and user_id = auth.uid() and tenant_role = _role
  );
$$;

create or replace function public.tenant_license_active(_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.tenants t
    where t.id = _tenant
      and (
        t.status in ('trialing','active')
        or (t.status = 'past_due' and now() < coalesce(t.grace_period_ends_at, now()))
      )
  );
$$;

-- 4. RLS on new tables ----------------------------------------
alter table public.tenants            enable row level security;
alter table public.tenant_members     enable row level security;
alter table public.plans              enable row level security;
alter table public.subscriptions      enable row level security;
alter table public.invoices           enable row level security;
alter table public.license_events     enable row level security;
alter table public.platform_admins    enable row level security;

drop policy if exists "members read tenant" on public.tenants;
create policy "members read tenant" on public.tenants for select
  using (public.is_tenant_member(id) or public.is_platform_admin(auth.uid()));

drop policy if exists "owners update tenant" on public.tenants;
create policy "owners update tenant" on public.tenants for update
  using (public.tenant_has_role(id, 'owner') or public.is_platform_admin(auth.uid()));

drop policy if exists "platform admins all tenants" on public.tenants;
create policy "platform admins all tenants" on public.tenants for all
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

drop policy if exists "members read members" on public.tenant_members;
create policy "members read members" on public.tenant_members for select
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin(auth.uid()));

drop policy if exists "owners manage members" on public.tenant_members;
create policy "owners manage members" on public.tenant_members for all
  using (public.tenant_has_role(tenant_id, 'owner') or public.is_platform_admin(auth.uid()))
  with check (public.tenant_has_role(tenant_id, 'owner') or public.is_platform_admin(auth.uid()));

drop policy if exists "plans readable" on public.plans;
create policy "plans readable" on public.plans for select using (true);

drop policy if exists "members read subs" on public.subscriptions;
create policy "members read subs" on public.subscriptions for select
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin(auth.uid()));

drop policy if exists "members read invoices" on public.invoices;
create policy "members read invoices" on public.invoices for select
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin(auth.uid()));

drop policy if exists "members read events" on public.license_events;
create policy "members read events" on public.license_events for select
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin(auth.uid()));

drop policy if exists "platform admin manage" on public.platform_admins;
create policy "platform admin manage" on public.platform_admins for all
  using (public.is_platform_admin(auth.uid()))
  with check (public.is_platform_admin(auth.uid()));

-- 5. Seed default plans ---------------------------------------
insert into public.plans (code, name, price_monthly_cents, max_users, features)
values
  ('starter','Starter', 2900,  5,  '{"reports":true,"loyalty":false}'),
  ('pro',    'Pro',     7900,  20, '{"reports":true,"loyalty":true,"sms":true}'),
  ('business','Business',19900, 100,'{"reports":true,"loyalty":true,"sms":true,"api":true}')
on conflict (code) do nothing;

-- 6. Default tenant + migrate existing rows -------------------
do $$
declare
  default_tenant uuid;
begin
  select id into default_tenant from public.tenants where slug = 'default';
  if default_tenant is null then
    insert into public.tenants (name, slug, status, trial_ends_at)
    values ('Default Workspace','default','active', now() + interval '100 years')
    returning id into default_tenant;
  end if;

  -- Backfill membership for all existing auth users as owners of default tenant
  insert into public.tenant_members (tenant_id, user_id, tenant_role)
  select default_tenant, u.id, 'owner'
  from auth.users u
  on conflict do nothing;
end $$;

-- 7. Add tenant_id to every business table, backfill, enforce -
-- Helper to do the same thing per table.
do $$
declare
  t text;
  tables text[] := array[
    'orders','services','customers','loyalty_transactions',
    'attendance_records','attendance_audit_log',
    'shift_templates','shifts','time_off_requests',
    'staff_face_enrollments','staff_pins','user_roles','receipt_settings'
  ];
  default_tenant uuid;
begin
  select id into default_tenant from public.tenants where slug = 'default';

  foreach t in array tables loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'skip missing table %', t; continue;
    end if;

    execute format('alter table public.%I add column if not exists tenant_id uuid', t);
    execute format('update public.%I set tenant_id = %L where tenant_id is null', t, default_tenant);
    execute format('alter table public.%I alter column tenant_id set not null', t);
    execute format('alter table public.%I alter column tenant_id set default public.current_tenant_id()', t);
    -- FK (skip if already exists)
    begin
      execute format('alter table public.%I add constraint %I foreign key (tenant_id) references public.tenants(id) on delete cascade',
        t, t || '_tenant_id_fkey');
    exception when duplicate_object then null; when others then null; end;
    execute format('create index if not exists %I on public.%I(tenant_id)', 'idx_'||t||'_tenant', t);
  end loop;
end $$;

-- 8. Replace RLS policies on existing tables ------------------
-- Generic policy: select+write require membership; writes also require active license.
do $$
declare
  t text;
  tables text[] := array[
    'orders','services','customers','loyalty_transactions',
    'attendance_records','attendance_audit_log',
    'shift_templates','shifts','time_off_requests',
    'staff_face_enrollments','staff_pins','user_roles','receipt_settings'
  ];
  pol record;
begin
  foreach t in array tables loop
    if to_regclass(format('public.%I', t)) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    -- drop ALL existing policies on the table to avoid old global-access ones
    for pol in execute format(
      'select policyname from pg_policies where schemaname=''public'' and tablename=%L', t
    ) loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;

    execute format($f$
      create policy "tenant read %1$s" on public.%1$I
      for select using (
        tenant_id = public.current_tenant_id()
        or public.is_platform_admin(auth.uid())
      )
    $f$, t);

    execute format($f$
      create policy "tenant write %1$s" on public.%1$I
      for all
      using (
        tenant_id = public.current_tenant_id()
        and public.tenant_license_active(tenant_id)
      )
      with check (
        tenant_id = public.current_tenant_id()
        and public.tenant_license_active(tenant_id)
      )
    $f$, t);
  end loop;
end $$;

-- 9. profiles table stays per-user (not tenant scoped) --------
-- Nothing to do; profile is identity, not business data.

-- 10. Auto-create tenant on new signup ------------------------
create or replace function public.handle_new_user_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_tenant uuid;
  base_slug text;
  candidate text;
  n int := 0;
begin
  -- If invited (joining existing tenant) the invite flow will add them — skip here
  -- if app_metadata.invited_to is present.
  if (new.raw_app_meta_data ? 'invited_to_tenant') then
    return new;
  end if;

  base_slug := lower(regexp_replace(coalesce(split_part(new.email,'@',1),'workspace'), '[^a-z0-9]+','-','g'));
  candidate := base_slug;
  while exists(select 1 from public.tenants where slug = candidate) loop
    n := n + 1;
    candidate := base_slug || '-' || n::text;
  end loop;

  insert into public.tenants (name, slug, status, trial_ends_at)
  values (coalesce(new.raw_user_meta_data->>'company_name', base_slug || '''s workspace'),
          candidate, 'trialing', now() + interval '30 days')
  returning id into new_tenant;

  insert into public.tenant_members (tenant_id, user_id, tenant_role)
  values (new_tenant, new.id, 'owner');

  return new;
end $$;

drop trigger if exists on_auth_user_created_tenant on auth.users;
create trigger on_auth_user_created_tenant
  after insert on auth.users
  for each row execute function public.handle_new_user_tenant();

-- 11. Realtime ------------------------------------------------
alter publication supabase_realtime add table public.tenants;
alter publication supabase_realtime add table public.subscriptions;

commit;

-- =============================================================
-- After running:
--   1. (optional) insert your own user into platform_admins:
--      insert into public.platform_admins(user_id) values ('<your-auth-uid>');
--   2. Phase 3 (Stripe) will populate plans.stripe_price_id.
-- =============================================================
