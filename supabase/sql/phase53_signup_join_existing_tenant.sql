-- Fix duplicate tenants created when a user signs up through a tenant share link
-- (…/login?tenant=<slug>&mode=signup). If the signup metadata carries
-- join_tenant_slug and that tenant exists, join it instead of creating a new one.
create or replace function public.handle_new_user_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_tenant uuid;
  base_slug text;
  candidate text;
  join_slug text;
  n int := 0;
begin
  -- Invited users are added by the invite flow.
  if (new.raw_app_meta_data ? 'invited_to_tenant') then
    return new;
  end if;

  join_slug := nullif(lower(trim(coalesce(new.raw_user_meta_data->>'join_tenant_slug', ''))), '');

  if join_slug is not null then
    select id into new_tenant from public.tenants where slug = join_slug;
    if new_tenant is not null then
      insert into public.tenant_members (tenant_id, user_id, tenant_role)
      values (new_tenant, new.id, 'member')
      on conflict do nothing;
      return new;
    end if;
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
