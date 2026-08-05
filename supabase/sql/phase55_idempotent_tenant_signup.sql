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
    on conflict (tenant_id, user_id) do update
      set tenant_role = excluded.tenant_role;

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