-- Phase 55: make Platform Console tenant-link signup idempotent.
--
-- A signup carrying a tenant join marker must join that tenant. It must never
-- fall through to standalone workspace creation when the marker is invalid.

create or replace function public.handle_new_user_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_tenant uuid;
  requested_tenant_id uuid;
  requested_tenant_id_text text;
  requested_slug text;
  base_slug text;
  candidate text;
  member_count integer;
  assigned_tenant_role public.tenant_role;
  n integer := 0;
begin
  -- Users created by the managed invitation/worker flow are assigned there.
  if new.raw_app_meta_data ? 'invited_to_tenant' then
    return new;
  end if;

  requested_tenant_id_text := nullif(trim(coalesce(new.raw_user_meta_data->>'join_tenant_id', '')), '');
  requested_slug := nullif(lower(trim(coalesce(new.raw_user_meta_data->>'join_tenant_slug', ''))), '');

  if requested_tenant_id_text is not null then
    begin
      requested_tenant_id := requested_tenant_id_text::uuid;
    exception when invalid_text_representation then
      raise exception 'The tenant signup link is invalid. Request a new link.' using errcode = '22023';
    end;

    -- Lock the tenant while deciding whether this first linked user is owner.
    select t.id
      into target_tenant
      from public.tenants t
      where t.id = requested_tenant_id
      for update;

    if target_tenant is null then
      raise exception 'The tenant signup link has expired or no longer exists.' using errcode = '22023';
    end if;

    if requested_slug is not null and not exists (
      select 1 from public.tenants t
      where t.id = target_tenant and t.slug = requested_slug
    ) then
      raise exception 'The tenant signup link does not match this workspace.' using errcode = '22023';
    end if;
  elsif requested_slug is not null then
    -- Backwards compatibility for signup links generated before tenant IDs
    -- were included. This branch is also fail-closed if the slug is stale.
    select t.id
      into target_tenant
      from public.tenants t
      where t.slug = requested_slug
      for update;

    if target_tenant is null then
      raise exception 'The tenant signup link has expired or no longer exists.' using errcode = '22023';
    end if;
  end if;

  if target_tenant is not null then
    select count(*)
      into member_count
      from public.tenant_members tm
      where tm.tenant_id = target_tenant;

    assigned_tenant_role := case when member_count = 0 then 'owner'::public.tenant_role
                                 else 'member'::public.tenant_role end;

    insert into public.tenant_members (tenant_id, user_id, tenant_role)
    values (target_tenant, new.id, assigned_tenant_role)
    on conflict (tenant_id, user_id) do nothing;

    return new;
  end if;

  -- No join marker means this is a genuine standalone signup.
  base_slug := trim(both '-' from lower(regexp_replace(
    coalesce(split_part(new.email, '@', 1), 'workspace'),
    '[^a-z0-9]+', '-', 'g'
  )));
  if base_slug = '' then
    base_slug := 'workspace';
  end if;

  candidate := base_slug;
  while exists (select 1 from public.tenants t where t.slug = candidate) loop
    n := n + 1;
    candidate := base_slug || '-' || n::text;
  end loop;

  insert into public.tenants (name, slug, status, trial_ends_at)
  values (
    coalesce(nullif(trim(new.raw_user_meta_data->>'company_name'), ''), base_slug || '''s workspace'),
    candidate,
    'trialing',
    now() + interval '30 days'
  )
  returning id into target_tenant;

  insert into public.tenant_members (tenant_id, user_id, tenant_role)
  values (target_tenant, new.id, 'owner');

  return new;
end;
$$;

revoke execute on function public.handle_new_user_tenant() from anon, authenticated, public;

-- Give the first linked tenant owner an application admin role after email
-- confirmation. Regular linked members retain the existing washer default.
create or replace function public.assign_default_role_on_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_tenant uuid;
  target_staff_role public.app_role;
  is_global_admin boolean;
begin
  if new.email_confirmed_at is not null
     and (old.email_confirmed_at is null or old.email_confirmed_at is distinct from new.email_confirmed_at)
  then
    select exists (select 1 from public.super_admins sa where sa.user_id = new.id)
        or exists (select 1 from public.platform_admins pa where pa.user_id = new.id)
        or lower(coalesce(new.email, '')) = 'postfastbiz@gmail.com'
      into is_global_admin;

    if is_global_admin then
      return new;
    end if;

    begin
      target_tenant := coalesce(
        nullif(new.raw_app_meta_data->>'active_tenant_id', '')::uuid,
        nullif(new.raw_app_meta_data->>'invited_to_tenant', '')::uuid,
        nullif(new.raw_user_meta_data->>'join_tenant_id', '')::uuid
      );
    exception when others then
      target_tenant := null;
    end;

    if target_tenant is null then
      select tm.tenant_id
        into target_tenant
        from public.tenant_members tm
        where tm.user_id = new.id
        order by tm.created_at asc
        limit 1;
    end if;

    if target_tenant is not null then
      select case
               when tm.tenant_role in ('owner'::public.tenant_role, 'admin'::public.tenant_role)
                 then 'admin'::public.app_role
               else 'washer'::public.app_role
             end
        into target_staff_role
        from public.tenant_members tm
        where tm.user_id = new.id
          and tm.tenant_id = target_tenant;

      if target_staff_role is not null then
        begin
          insert into public.user_roles (user_id, tenant_id, role)
          select new.id, target_tenant, target_staff_role
          where not exists (
            select 1
            from public.user_roles ur
            where ur.user_id = new.id
              and ur.tenant_id = target_tenant
          )
          on conflict (user_id, role) do nothing;
        exception when others then
          raise warning 'Skipping default role assignment for confirmed user %: %', new.id, sqlerrm;
        end;
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.assign_default_role_on_confirm() from anon, authenticated, public;