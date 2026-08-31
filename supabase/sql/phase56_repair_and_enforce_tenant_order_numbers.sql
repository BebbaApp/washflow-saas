-- Phase 56: repair mixed global/per-tenant work-order numbers and ensure that
-- the canonical counter can only move forward from each tenant's own rows.

begin;

-- Remove the retired global uniqueness rule and temporarily remove tenant
-- uniqueness while existing rows are parked and renumbered.
alter table public.orders drop constraint if exists orders_order_number_key;
drop index if exists public.orders_order_number_key;
drop index if exists public.orders_tenant_order_number_uidx;

update public.orders
set order_number = 'TMP-' || id::text;

with numbered as (
  select
    id,
    'W-' || lpad(
      row_number() over (
        partition by tenant_id
        order by created_at asc, id asc
      )::text,
      3,
      '0'
    ) as order_number
  from public.orders
)
update public.orders as o
set order_number = n.order_number
from numbered as n
where n.id = o.id;

insert into public.tenant_order_counters (tenant_id, last_number)
select tenant_id, count(*)::integer
from public.orders
group by tenant_id
on conflict (tenant_id) do update
set last_number = excluded.last_number;

create unique index orders_tenant_order_number_uidx
  on public.orders (tenant_id, order_number);

-- Retire the old global allocator so stale clients cannot call it.
revoke execute on function public.next_order_number() from anon, authenticated;

commit;

-- Verification: first_number must be W-001; last_number and counter_value must
-- both equal order_count for every tenant after this repair.
select
  t.name,
  count(o.id) as order_count,
  'W-' || lpad(min(nullif(regexp_replace(o.order_number, '\D', '', 'g'), '')::int)::text, 3, '0') as first_number,
  'W-' || lpad(max(nullif(regexp_replace(o.order_number, '\D', '', 'g'), '')::int)::text, 3, '0') as last_number,
  c.last_number as counter_value
from public.tenants as t
left join public.orders as o on o.tenant_id = t.id
left join public.tenant_order_counters as c on c.tenant_id = t.id
group by t.id, t.name, c.last_number
order by t.name;