-- Phase 54: per-tenant work order numbering (each tenant starts at W-001)

-- 1) Counter table (one row per tenant)
create table if not exists public.tenant_order_counters (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  last_number integer not null default 0
);

grant select on public.tenant_order_counters to authenticated;
grant all on public.tenant_order_counters to service_role;

alter table public.tenant_order_counters enable row level security;

drop policy if exists "members read own tenant counter" on public.tenant_order_counters;
create policy "members read own tenant counter"
on public.tenant_order_counters
for select
to authenticated
using (public.is_tenant_member(tenant_id));

-- 2) Renumber existing orders per tenant, starting at W-001 (chronological)
with numbered as (
  select id,
         'W-' || lpad(row_number() over (partition by tenant_id order by created_at asc, id asc)::text, 3, '0') as new_number
  from public.orders
)
update public.orders o
set order_number = n.new_number
from numbered n
where o.id = n.id
  and o.order_number is distinct from n.new_number;

-- 3) Seed counters from current max per tenant
insert into public.tenant_order_counters (tenant_id, last_number)
select tenant_id,
       coalesce(max(nullif(regexp_replace(order_number, '\D', '', 'g'), '')::int), 0)
from public.orders
group by tenant_id
on conflict (tenant_id) do update set last_number = excluded.last_number;

-- 4) Uniqueness scoped to tenant (drop any global unique constraint/index)
alter table public.orders drop constraint if exists orders_order_number_key;
drop index if exists public.orders_order_number_key;
create unique index if not exists orders_tenant_order_number_uidx
  on public.orders (tenant_id, order_number);

-- 5) Per-tenant sequential number generator
create or replace function public.next_tenant_order_number(_tenant uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  if _tenant is null then
    raise exception 'tenant_id is required' using errcode = '22023';
  end if;

  insert into public.tenant_order_counters (tenant_id, last_number)
  values (
    _tenant,
    coalesce((
      select max(nullif(regexp_replace(order_number, '\D', '', 'g'), '')::int)
      from public.orders
      where tenant_id = _tenant
    ), 0)
  )
  on conflict (tenant_id) do nothing;

  update public.tenant_order_counters
  set last_number = last_number + 1
  where tenant_id = _tenant
  returning last_number into n;

  return 'W-' || lpad(n::text, 3, '0');
end;
$$;

grant execute on function public.next_tenant_order_number(uuid) to authenticated, service_role;
