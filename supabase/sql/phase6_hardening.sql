-- =============================================================
-- Phase 6: Per-tenant receipt settings + extended audit logging
-- Run in Supabase SQL Editor. Idempotent.
-- =============================================================
begin;

-- =============================================================
-- 1. PER-TENANT receipt_settings
-- =============================================================

-- Add tenant_id column if missing
alter table public.receipt_settings
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;

-- Backfill: if a legacy singleton row exists (id=true) and we have
-- exactly one tenant, attribute it. Then seed defaults for every tenant.
do $$
declare
  legacy record;
  t_count int;
  only_tenant uuid;
begin
  select count(*) into t_count from public.tenants;
  select * into legacy from public.receipt_settings where tenant_id is null limit 1;

  if legacy.id is not null and t_count = 1 then
    select id into only_tenant from public.tenants limit 1;
    update public.receipt_settings
      set tenant_id = only_tenant
      where tenant_id is null;
  end if;

  -- Delete any still-orphan rows (no tenant we can attribute them to)
  delete from public.receipt_settings where tenant_id is null;

  -- Seed defaults for tenants without a row
  insert into public.receipt_settings (tenant_id)
  select t.id from public.tenants t
  left join public.receipt_settings rs on rs.tenant_id = t.id
  where rs.tenant_id is null;
end $$;

-- Drop legacy singleton constraints / PK if present
do $$ begin
  if exists (
    select 1 from pg_constraint
    where conname = 'receipt_settings_singleton'
      and conrelid = 'public.receipt_settings'::regclass
  ) then
    alter table public.receipt_settings drop constraint receipt_settings_singleton;
  end if;
end $$;

do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='receipt_settings' and column_name='id'
  ) then
    -- Drop the old PK on id if it's still there
    alter table public.receipt_settings drop constraint if exists receipt_settings_pkey;
    alter table public.receipt_settings drop column if exists id;
  end if;
end $$;

-- Make tenant_id NOT NULL and the new primary key
alter table public.receipt_settings alter column tenant_id set not null;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'receipt_settings_pkey'
      and conrelid = 'public.receipt_settings'::regclass
  ) then
    alter table public.receipt_settings add primary key (tenant_id);
  end if;
end $$;

alter table public.receipt_settings
  alter column tenant_id set default public.current_tenant_id();

-- Replace RLS policies with tenant-scoped ones
alter table public.receipt_settings enable row level security;

drop policy if exists "Authenticated can read receipt settings" on public.receipt_settings;
drop policy if exists "Admins/managers can update receipt settings" on public.receipt_settings;
drop policy if exists "Admins/managers can insert receipt settings" on public.receipt_settings;

create policy "tenant members read receipt settings"
  on public.receipt_settings for select to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin(auth.uid()));

create policy "tenant admins insert receipt settings"
  on public.receipt_settings for insert to authenticated
  with check (
    public.tenant_has_role(tenant_id, 'owner')
    or public.tenant_has_role(tenant_id, 'admin')
    or public.is_platform_admin(auth.uid())
  );

create policy "tenant admins update receipt settings"
  on public.receipt_settings for update to authenticated
  using (
    public.tenant_has_role(tenant_id, 'owner')
    or public.tenant_has_role(tenant_id, 'admin')
    or public.is_platform_admin(auth.uid())
  )
  with check (
    public.tenant_has_role(tenant_id, 'owner')
    or public.tenant_has_role(tenant_id, 'admin')
    or public.is_platform_admin(auth.uid())
  );

-- Realtime: keep enabled (table is already in publication; re-add is idempotent guard)
do $$ begin
  alter publication supabase_realtime add table public.receipt_settings;
exception when duplicate_object then null; end $$;

-- Auto-seed defaults for new tenants
create or replace function public.seed_tenant_receipt_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.receipt_settings (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_seed_tenant_receipt_settings on public.tenants;
create trigger trg_seed_tenant_receipt_settings
  after insert on public.tenants
  for each row execute function public.seed_tenant_receipt_settings();

-- =============================================================
-- 2. EXTENDED AUDIT LOG
-- =============================================================

-- Loosen action check constraint
do $$
declare
  conname_ text;
begin
  select conname into conname_
  from pg_constraint
  where conrelid = 'public.membership_audit_log'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%action%';
  if conname_ is not null then
    execute format('alter table public.membership_audit_log drop constraint %I', conname_);
  end if;
end $$;

alter table public.membership_audit_log
  add constraint membership_audit_log_action_check
  check (action in (
    'invite.created','invite.revoked','invite.accepted','invite.expired',
    'member.role_updated','member.removed','member.left',
    'tenant.settings_updated','tenant.billing_updated',
    'platform_admin.granted','platform_admin.revoked',
    'receipt_settings.updated'
  ));

-- ---- Trigger: tenants table updates ----
create or replace function public.log_tenant_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  actor_em text;
  changes jsonb := '{}'::jsonb;
  is_billing boolean := false;
begin
  select email into actor_em from auth.users where id = actor;

  if new.name is distinct from old.name then
    changes := changes || jsonb_build_object('name', jsonb_build_object('from', old.name, 'to', new.name));
  end if;
  if new.slug is distinct from old.slug then
    changes := changes || jsonb_build_object('slug', jsonb_build_object('from', old.slug, 'to', new.slug));
  end if;
  if new.plan_id is distinct from old.plan_id then
    changes := changes || jsonb_build_object('plan_id', jsonb_build_object('from', old.plan_id, 'to', new.plan_id));
    is_billing := true;
  end if;
  if new.status is distinct from old.status then
    changes := changes || jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status));
    is_billing := true;
  end if;
  if new.current_period_end is distinct from old.current_period_end
     or new.grace_period_ends_at is distinct from old.grace_period_ends_at then
    is_billing := true;
  end if;

  if changes = '{}'::jsonb and not is_billing then
    return new;
  end if;

  insert into public.membership_audit_log
    (tenant_id, actor_user_id, actor_email, action, payload)
  values
    (new.id, actor, actor_em,
     case when is_billing then 'tenant.billing_updated' else 'tenant.settings_updated' end,
     changes);
  return new;
end $$;

drop trigger if exists trg_log_tenant_update on public.tenants;
create trigger trg_log_tenant_update
  after update on public.tenants
  for each row execute function public.log_tenant_update();

-- ---- Trigger: platform_admins ----
create or replace function public.log_platform_admin_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  actor_em text;
  tgt uuid;
  tgt_em text;
  tnt uuid := public.current_tenant_id();
begin
  select email into actor_em from auth.users where id = actor;
  if tg_op = 'INSERT' then
    tgt := new.user_id;
  else
    tgt := old.user_id;
  end if;
  select email into tgt_em from auth.users where id = tgt;

  -- audit log requires non-null tenant_id; skip if no scope
  if tnt is null then
    return coalesce(new, old);
  end if;

  insert into public.membership_audit_log
    (tenant_id, actor_user_id, actor_email, target_user_id, target_email, action)
  values
    (tnt, actor, actor_em, tgt, tgt_em,
     case when tg_op = 'INSERT' then 'platform_admin.granted' else 'platform_admin.revoked' end);
  return coalesce(new, old);
end $$;

drop trigger if exists trg_log_platform_admin on public.platform_admins;
create trigger trg_log_platform_admin
  after insert or delete on public.platform_admins
  for each row execute function public.log_platform_admin_change();

-- ---- Trigger: receipt_settings updates ----
create or replace function public.log_receipt_settings_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  actor_em text;
  changes jsonb := '{}'::jsonb;
begin
  select email into actor_em from auth.users where id = actor;

  if new.business_name is distinct from old.business_name then
    changes := changes || jsonb_build_object('business_name', jsonb_build_object('from', old.business_name, 'to', new.business_name));
  end if;
  if new.business_line2 is distinct from old.business_line2 then
    changes := changes || jsonb_build_object('business_line2', jsonb_build_object('from', old.business_line2, 'to', new.business_line2));
  end if;
  if new.footer is distinct from old.footer then
    changes := changes || jsonb_build_object('footer', jsonb_build_object('from', old.footer, 'to', new.footer));
  end if;

  if changes = '{}'::jsonb then
    return new;
  end if;

  insert into public.membership_audit_log
    (tenant_id, actor_user_id, actor_email, action, payload)
  values
    (new.tenant_id, actor, actor_em, 'receipt_settings.updated', changes);
  return new;
end $$;

drop trigger if exists trg_log_receipt_settings on public.receipt_settings;
create trigger trg_log_receipt_settings
  after update on public.receipt_settings
  for each row execute function public.log_receipt_settings_update();

commit;
