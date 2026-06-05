-- Fix infinite recursion on super_admins RLS by replacing any self-referential
-- policy with a simple "users can read their own row" policy. Mutations stay
-- restricted to service_role / SECURITY DEFINER paths.

do $$
declare p record;
begin
  for p in select polname from pg_policy where polrelid = 'public.super_admins'::regclass loop
    execute format('drop policy if exists %I on public.super_admins', p.polname);
  end loop;
end $$;

alter table public.super_admins enable row level security;

create policy "Users can read their own super_admin row"
  on public.super_admins for select
  to authenticated
  using (user_id = auth.uid());

grant select on public.super_admins to authenticated;
grant all on public.super_admins to service_role;
