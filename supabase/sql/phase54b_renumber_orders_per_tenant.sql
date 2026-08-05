-- Phase 54b: force per-tenant renumbering of work orders (idempotent, re-runnable)
-- Fixes the case where phase54 aborted before renumbering, leaving old global
-- numbers (e.g. W-424) and out-of-sync counters.

begin;

-- 1) Remove ANY uniqueness on order_number while we renumber (row-by-row
--    updates would otherwise collide against a non-deferrable unique index).
alter table public.orders drop constraint if exists orders_order_number_key;
drop index if exists public.orders_order_number_key;
drop index if exists public.orders_tenant_order_number_uidx;

-- 2) Two-pass renumber: park values in a temporary namespace first so no
--    intermediate state can clash with existing numbers.
update public.orders
set order_number = 'TMP-' || id::text;

with numbered as (
  select id,
         'W-' || lpad(
           row_number() over (partition by tenant_id order by created_at asc, id asc)::text,
           3, '0') as new_number
  from public.orders
)
update public.orders o
set order_number = n.new_number
from numbered n
where o.id = n.id;

-- 3) Re-seed counters from the true max per tenant
insert into public.tenant_order_counters (tenant_id, last_number)
select tenant_id,
       coalesce(max(nullif(regexp_replace(order_number, '\D', '', 'g'), '')::int), 0)
from public.orders
group by tenant_id
on conflict (tenant_id) do update set last_number = excluded.last_number;

-- 4) Restore per-tenant uniqueness
create unique index if not exists orders_tenant_order_number_uidx
  on public.orders (tenant_id, order_number);

commit;

-- Verify
-- select t.name, count(*) orders, min(o.order_number) first, max(o.order_number) last, c.last_number
-- from public.orders o
-- join public.tenants t on t.id = o.tenant_id
-- left join public.tenant_order_counters c on c.tenant_id = o.tenant_id
-- group by t.name, c.last_number order by t.name;
