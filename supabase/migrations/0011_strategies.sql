-- Strategies as first-class objects.
--
-- A strategy is a concrete configuration: one framework, one timeframe,
-- a fixed list of pairs, and risk rules. The scanner now iterates over
-- active strategies rather than running every framework against every
-- pair. v1 ships with one active strategy: mean reversion on
-- BTC/ETH/SOL on the 1h timeframe.
--
-- A partial unique index enforces only one active strategy at a time
-- so the operator cannot accidentally have two strategies firing
-- alerts simultaneously. To switch strategies, deactivate the current
-- one first, then activate the next.
--
-- RLS is enabled with a permissive SELECT for authenticated users so
-- the (future) settings UI can display strategies. Writes go through
-- the service role from server actions, which bypasses RLS.
--
-- alerts gains a nullable strategy_id reference so each alert can be
-- traced back to the strategy that fired it. The column is nullable
-- so historic alerts (which predate strategies) keep working.

create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  framework_id text not null,
  timeframe text not null check (timeframe in ('15m', '1h', '4h', '1d')),
  pair_symbols text[] not null,
  risk_amount_gbp numeric not null,
  min_rr numeric not null default 2.0,
  max_concurrent_positions integer not null default 3,
  max_daily_loss_gbp numeric,
  max_consecutive_losers integer default 5,
  is_active boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index strategies_one_active
  on public.strategies (is_active)
  where is_active = true;

create index strategies_active_idx on public.strategies (is_active);

alter table public.strategies enable row level security;

drop policy if exists strategies_select_all on public.strategies;
create policy strategies_select_all on public.strategies
  for select to authenticated using (true);

grant select on public.strategies to authenticated;

-- v1 default: mean reversion on BTC/ETH/SOL on 1h candles. Risk per
-- trade is a small fixed GBP amount; daily loss cap and consecutive
-- losers cap are recorded for downstream consumers (the scanner does
-- not enforce them in v1).
insert into public.strategies (
  name,
  framework_id,
  timeframe,
  pair_symbols,
  risk_amount_gbp,
  min_rr,
  max_concurrent_positions,
  max_daily_loss_gbp,
  max_consecutive_losers,
  is_active
) values (
  'Mean Reversion v1',
  'mean_reversion_v1',
  '1h',
  ARRAY['BTC', 'ETH', 'SOL'],
  30.00,
  2.0,
  3,
  100.00,
  5,
  true
);

alter table public.alerts
  add column strategy_id uuid references public.strategies(id) on delete set null;

create index alerts_strategy_idx
  on public.alerts (strategy_id, triggered_at desc);
