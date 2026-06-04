-- Phase 26: tenant-wide vehicle/water inventory links
-- Moves the "Auto-link by name" mappings from localStorage to Supabase so they
-- persist across devices/users in the same tenant and wash completions always
-- have a chemical/water mapping available.

create table if not exists public.inventory_vehicle_map (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id(),
  key text not null,              -- concentrate key (e.g. 'shampoo') or '__water__'
  item_id uuid not null,          -- references inventory_items.id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key)
);

grant select, insert, update, delete on public.inventory_vehicle_map to authenticated;
grant all on public.inventory_vehicle_map to service_role;

alter table public.inventory_vehicle_map enable row level security;

create policy "tenant read inventory_vehicle_map"
  on public.inventory_vehicle_map for select to authenticated
  using (tenant_id = current_tenant_id());

create policy "tenant write inventory_vehicle_map"
  on public.inventory_vehicle_map for all to authenticated
  using (tenant_id = current_tenant_id() and tenant_license_active(tenant_id))
  with check (tenant_id = current_tenant_id() and tenant_license_active(tenant_id));

-- keep updated_at fresh
drop trigger if exists trg_inv_vehicle_map_updated on public.inventory_vehicle_map;
create trigger trg_inv_vehicle_map_updated
  before update on public.inventory_vehicle_map
  for each row execute function public.update_updated_at_column();

-- realtime
alter publication supabase_realtime add table public.inventory_vehicle_map;
