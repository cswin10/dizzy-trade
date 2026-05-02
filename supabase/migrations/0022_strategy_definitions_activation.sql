-- Operational metadata for composable strategies.
--
-- The strategy_definitions table introduced in 0019 stores the
-- strategy as JSON. The scanner needs a few extra columns to know
-- which definition is currently live, which pairs to scan, and the
-- timeframe / risk knobs that the rules engine reads (these are
-- not part of the strategy logic itself, just the operational
-- envelope around it). Mirrors the legacy public.strategies shape.
--
-- A partial unique index enforces only one active definition per
-- tenant. A separate enforcement step at the application layer
-- ensures cross-table mutual exclusion with the legacy table; we
-- could not express that constraint with a single Postgres index
-- without uniting the two schemas.

alter table public.strategy_definitions
  add column if not exists is_active boolean not null default false,
  add column if not exists pairs text[] not null default '{}',
  add column if not exists timeframe text not null default '1h',
  add column if not exists max_concurrent_positions integer not null default 3,
  add column if not exists max_daily_loss_gbp numeric,
  add column if not exists max_consecutive_losers integer;

create unique index if not exists strategy_definitions_one_active_per_tenant
  on public.strategy_definitions (tenant_id)
  where is_active = true;

create index if not exists strategy_definitions_active_idx
  on public.strategy_definitions (is_active)
  where is_active = true;
