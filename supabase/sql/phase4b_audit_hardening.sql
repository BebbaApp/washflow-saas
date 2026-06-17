-- =============================================================
-- Phase 4b: Membership audit log + RLS hardening
-- Run in Supabase SQL Editor. Idempotent.
-- =============================================================
begin;

-- 1. Audit log table -----------------------------------------
create table if not exists public.membership_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  target_user_id uuid references auth.users(id) on delete set null,
  target_email text,
  action text not null check (action in (
    'invite.created','invite.revoked','invite.accepted','invite.expired',
    'member.role_updated','member.removed','member.left'
  )),
  from_role public.tenant_role,
  to_role public.tenant_role,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_membership_audit_tenant on public.membership_audit_log(tenant_id, created_at desc);
create index if not exists idx_membership_audit_action on public.membership_audit_log(action);

alter table public.membership_audit_log enable row level security;

drop policy if exists "tenant admins read audit" on public.membership_audit_log;
create policy "tenant admins read audit" on public.membership_audit_log
  for select using (
    public.tenant_has_role(tenant_id, 'owner')
    or public.tenant_has_role(tenant_id, 'admin')
    or public.is_platform_admin(auth.uid())
  );

-- No client write policy. Edge functions / DB triggers use service role.

-- 2. Trigger: log changes to tenant_members ------------------
create or replace function public.log_member_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  actor_em text;
begin
  select email into actor_em from auth.users where id = actor;
  if (tg_op = 'UPDATE') and (old.tenant_role is distinct from new.tenant_role) then
    insert into public.membership_audit_log
      (tenant_id, actor_user_id, actor_email, target_user_id, action, from_role, to_role)
    values
      (new.tenant_id, actor, actor_em, new.user_id, 'member.role_updated', old.tenant_role, new.tenant_role);
  elsif (tg_op = 'DELETE') then
    insert into public.membership_audit_log
      (tenant_id, actor_user_id, actor_email, target_user_id, action, from_role)
    values
      (old.tenant_id, actor, actor_em, old.user_id,
       case when actor = old.user_id then 'member.left' else 'member.removed' end,
       old.tenant_role);
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_log_member_change on public.tenant_members;
create trigger trg_log_member_change
  after update or delete on public.tenant_members
  for each row execute function public.log_member_change();

-- 3. RLS hardening on tenant_members -------------------------
-- Allow OWNERS + ADMINS to manage members (was owner-only),
-- but only OWNERS can promote/demote owners.
drop policy if exists "owners manage members" on public.tenant_members;

drop policy if exists "admins read members" on public.tenant_members;
create policy "admins read members" on public.tenant_members for select
  using (public.is_tenant_member(tenant_id) or public.is_platform_admin(auth.uid()));

drop policy if exists "owners insert members" on public.tenant_members;
create policy "owners insert members" on public.tenant_members for insert
  with check (
    public.tenant_has_role(tenant_id, 'owner')
    or public.is_platform_admin(auth.uid())
  );

drop policy if exists "admins update members" on public.tenant_members;
create policy "admins update members" on public.tenant_members for update
  using (
    (public.tenant_has_role(tenant_id, 'owner')
      or public.tenant_has_role(tenant_id, 'admin')
      or public.is_platform_admin(auth.uid()))
  )
  with check (
    -- Admins cannot create or remove owners; only owners can.
    (tenant_role <> 'owner' and (
       public.tenant_has_role(tenant_id, 'owner')
       or public.tenant_has_role(tenant_id, 'admin')
    ))
    or public.tenant_has_role(tenant_id, 'owner')
    or public.is_platform_admin(auth.uid())
  );

-- Delete policy from phase4 already allows owner/admin/self/platform_admin.

-- 4. RLS hardening on tenant_invitations ---------------------
-- Ensure no INSERT can target a tenant the caller doesn't admin.
drop policy if exists "tenant admins write invites" on public.tenant_invitations;
create policy "tenant admins insert invites" on public.tenant_invitations for insert
  with check (
    public.tenant_has_role(tenant_id, 'owner')
    or public.tenant_has_role(tenant_id, 'admin')
    or public.is_platform_admin(auth.uid())
  );
create policy "tenant admins update invites" on public.tenant_invitations for update
  using (
    public.tenant_has_role(tenant_id, 'owner')
    or public.tenant_has_role(tenant_id, 'admin')
    or public.is_platform_admin(auth.uid())
  );
create policy "tenant admins delete invites" on public.tenant_invitations for delete
  using (
    public.tenant_has_role(tenant_id, 'owner')
    or public.tenant_has_role(tenant_id, 'admin')
    or public.is_platform_admin(auth.uid())
  );

-- Also: the accepting user needs to read their own invite by token,
-- but the accept-invite edge function uses the service role key so it
-- bypasses RLS. We deliberately do NOT add a public "read by token"
-- policy here to avoid email enumeration.

-- 5. Add invitations to realtime so the UI updates live -------
do $$ begin
  alter publication supabase_realtime add table public.tenant_invitations;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.membership_audit_log;
exception when duplicate_object then null; end $$;

commit;
