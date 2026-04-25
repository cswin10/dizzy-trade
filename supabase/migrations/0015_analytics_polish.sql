-- Analytics polish layer.
--
-- 1. trades.btc_context_at_entry is captured by the trade-log action
--    using BTC's most recent 1h candles. Trades logged before this
--    feature stay null and are surfaced as "unknown" on the analytics
--    page so the data model is honest about what was missed.
--
-- 2. user_preferences holds per-tenant UI choices. For 14b only the
--    analytics_layout key is used (panel ids in display order); the
--    table is shaped to accept future preference keys without further
--    migrations.
--
-- All idempotent so the migration can be re-run safely.

alter table public.trades
  add column if not exists btc_context_at_entry text
    check (btc_context_at_entry in ('up', 'down', 'ranging'));

create table if not exists public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade unique,
  analytics_layout jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists user_preferences_select_own on public.user_preferences;
create policy user_preferences_select_own on public.user_preferences
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists user_preferences_insert_own on public.user_preferences;
create policy user_preferences_insert_own on public.user_preferences
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists user_preferences_update_own on public.user_preferences;
create policy user_preferences_update_own on public.user_preferences
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

grant select, insert, update on public.user_preferences to authenticated;
