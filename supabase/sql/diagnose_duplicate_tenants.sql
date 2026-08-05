-- Read-only duplicate tenant diagnostic.
-- Review every tenant's business data before deleting or merging any row.

with tenant_usage as (
  select
    t.id,
    t.name,
    t.slug,
    t.created_at,
    count(distinct tm.user_id) as member_count,
    count(distinct o.id) as order_count,
    count(distinct e.id) as expense_count,
    count(distinct ii.id) as inventory_item_count
  from public.tenants t
  left join public.tenant_members tm on tm.tenant_id = t.id
  left join public.orders o on o.tenant_id = t.id
  left join public.expenses e on e.tenant_id = t.id
  left join public.inventory_items ii on ii.tenant_id = t.id
  group by t.id, t.name, t.slug, t.created_at
), duplicate_names as (
  select lower(trim(name)) as normalized_name
  from public.tenants
  group by lower(trim(name))
  having count(*) > 1
)
select
  u.*,
  (u.member_count = 0
    and u.order_count = 0
    and u.expense_count = 0
    and u.inventory_item_count = 0) as appears_empty
from tenant_usage u
join duplicate_names d on d.normalized_name = lower(trim(u.name))
order by lower(trim(u.name)), u.created_at;