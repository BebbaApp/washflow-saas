-- Phase 50: fix global expense category visibility.
-- The deployed read policy on expense_categories still required
-- tenant_id = current_tenant_id(), so the GLOBAL catalog (tenant_id IS NULL)
-- was invisible to managers/supervisors — only platform admins saw it.
-- Idempotent; applied to production on 2026-07-30.

alter table public.expense_categories alter column tenant_id drop not null;
alter table public.expense_categories alter column tenant_id drop default;

grant select, insert, update, delete on public.expense_categories to authenticated;
grant all on public.expense_categories to service_role;

drop policy if exists "tenant read expense_categories" on public.expense_categories;
create policy "tenant read expense_categories"
on public.expense_categories for select to authenticated
using (tenant_id is null or tenant_id = public.current_tenant_id() or public.is_platform_admin(auth.uid()));

drop policy if exists "tenant write expense_categories" on public.expense_categories;
create policy "tenant write expense_categories"
on public.expense_categories for all to authenticated
using (
  (tenant_id is null and public.is_platform_admin(auth.uid()))
  or (tenant_id is not null and tenant_id = public.current_tenant_id() and public.tenant_license_active(tenant_id))
  or public.is_platform_admin(auth.uid())
)
with check (
  (tenant_id is null and public.is_platform_admin(auth.uid()))
  or (tenant_id is not null and tenant_id = public.current_tenant_id() and public.tenant_license_active(tenant_id))
  or public.is_platform_admin(auth.uid())
);
