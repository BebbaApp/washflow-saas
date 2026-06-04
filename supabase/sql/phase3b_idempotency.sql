-- =============================================================
-- Phase 3b: Webhook idempotency + license_events admin access.
-- Run in Supabase SQL Editor (idempotent).
-- =============================================================
begin;

create table if not exists public.processed_stripe_events (
  stripe_event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.processed_stripe_events enable row level security;

drop policy if exists "platform admins read processed events" on public.processed_stripe_events;
create policy "platform admins read processed events" on public.processed_stripe_events
  for select using (public.is_platform_admin(auth.uid()));

-- license_events: platform admins can read across all tenants
drop policy if exists "platform admins read all events" on public.license_events;
create policy "platform admins read all events" on public.license_events
  for select using (public.is_platform_admin(auth.uid()));

commit;
