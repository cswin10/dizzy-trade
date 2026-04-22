-- Scanner foundation.
--
-- Three new tables plus a realtime publication entry. The scanner Edge
-- Function reads `universe` to know which pairs to watch, writes one
-- `market_snapshots` row per pair per tick (so frameworks can look at
-- rolling OI/funding history), and writes `alerts` when a framework
-- triggers.
--
-- RLS posture for v1: universe and market_snapshots are global reference
-- data shared across all tenants, so RLS stays off. Alerts are also
-- global for now; we add a nullable tenant_id so that per-tenant alerts
-- can be introduced later without another migration.

-- Universe -------------------------------------------------------------

create table public.universe (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,
  coingecko_id text,
  is_watchlist boolean not null default false,
  is_active boolean not null default true,
  added_at timestamptz default now(),
  added_by uuid references auth.users(id) on delete set null
);

create index universe_active_idx on public.universe (is_active);
create index universe_watchlist_idx on public.universe (is_watchlist)
  where is_watchlist;

-- Initial seed. Majors and narrative leaders are flagged as watchlist so
-- their alerts drive a Telegram notification. The rest broaden coverage
-- without the noise cost.
insert into public.universe (symbol, is_watchlist) values
  ('BTC', true),
  ('ETH', true),
  ('SOL', true),
  ('FET', true),
  ('TAO', true),
  ('ONDO', true),
  ('WIF', true),
  ('ARB', true),
  ('AVAX', false),
  ('MATIC', false),
  ('LINK', false),
  ('UNI', false),
  ('AAVE', false),
  ('ATOM', false),
  ('DOT', false),
  ('NEAR', false),
  ('INJ', false),
  ('SEI', false),
  ('SUI', false),
  ('APT', false),
  ('OP', false),
  ('STRK', false),
  ('TIA', false),
  ('PEPE', false),
  ('DOGE', false),
  ('SHIB', false),
  ('LTC', false),
  ('BCH', false);

-- Market snapshots ----------------------------------------------------

-- Scanner writes one row per pair per tick (roughly every 60s). Provides
-- a rolling history of funding and open interest that frameworks can
-- reduce over without hitting the exchange for historicals. Old rows
-- can be trimmed by a separate retention job; for v1 we keep everything.
create table public.market_snapshots (
  id bigserial primary key,
  symbol text not null,
  mark_price numeric,
  funding numeric,
  open_interest numeric,
  day_notional_volume numeric,
  captured_at timestamptz not null default now()
);

create index market_snapshots_symbol_time_idx
  on public.market_snapshots (symbol, captured_at desc);

-- Alerts --------------------------------------------------------------

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  framework_id text not null,
  symbol text not null,
  coingecko_id text,
  triggered_at timestamptz not null default now(),
  condition_values jsonb not null default '{}'::jsonb,
  suggested_direction text
    check (suggested_direction in ('long', 'short')),
  suggested_entry numeric,
  suggested_stop numeric,
  suggested_target numeric,
  is_watchlist boolean not null default false,
  trade_id uuid references public.trades(id) on delete set null,
  dismissed boolean not null default false,
  dismissed_at timestamptz,
  notified_telegram boolean not null default false
);

create index alerts_triggered_at_idx
  on public.alerts (triggered_at desc);
create index alerts_framework_triggered_at_idx
  on public.alerts (framework_id, triggered_at desc);
create index alerts_symbol_triggered_at_idx
  on public.alerts (symbol, triggered_at desc);
create index alerts_trade_id_idx on public.alerts (trade_id)
  where trade_id is not null;

-- Realtime ------------------------------------------------------------

alter publication supabase_realtime add table public.alerts;
