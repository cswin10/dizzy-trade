-- Scanner RLS and SELECT policies.
--
-- Migration 0006 created the scanner tables without enabling RLS, on the
-- assumption that they were global reference data readable by any signed
-- in user. Supabase projects now enable RLS on new public-schema tables
-- by default, which left the tables readable only by superusers and
-- broke the /alerts page and the dashboard "Last scan" chip.
--
-- This migration makes the RLS posture explicit so fresh deploys do not
-- hit the same trap:
--   1. Enable RLS on all three tables.
--   2. Grant authenticated users SELECT via permissive policies.
--   3. Writes continue to come only from service_role, which bypasses
--      RLS automatically.
--
-- Per-tenant alert scoping can be added later by replacing
-- `alerts_select_all` with a policy that checks tenant_id against
-- current_tenant_id().

alter table public.alerts enable row level security;
alter table public.market_snapshots enable row level security;
alter table public.universe enable row level security;

drop policy if exists alerts_select_all on public.alerts;
create policy alerts_select_all on public.alerts
  for select to authenticated using (true);

drop policy if exists market_snapshots_select_all on public.market_snapshots;
create policy market_snapshots_select_all on public.market_snapshots
  for select to authenticated using (true);

drop policy if exists universe_select_all on public.universe;
create policy universe_select_all on public.universe
  for select to authenticated using (true);

-- Belt and braces in case the project was created without default
-- table grants. These are idempotent.
grant select on public.alerts to authenticated;
grant select on public.market_snapshots to authenticated;
grant select on public.universe to authenticated;
