-- Funding rates cache.
--
-- Hyperliquid pays funding every hour on perps. Funding extremes
-- (very positive = longs paying shorts heavily, very negative =
-- shorts paying longs heavily) are a documented edge source: the
-- backtest engine and live scanner both want to be able to read the
-- prevailing rate at a point in time and decide whether a strategy
-- should fire.
--
-- Tenant-shared, like backtest_candles: the data is public market
-- data, no point duplicating it per tenant. Authenticated users can
-- read; writes go through the service role from the fetcher /
-- backfill / scanner paths, which bypass RLS.
--
-- The unique (coin, ts, interval_hours) constraint lets idempotent
-- backfills and live ticks insert with on-conflict-do-nothing.

create table public.funding_rates (
  id uuid primary key default gen_random_uuid(),
  coin text not null,
  ts timestamptz not null,
  rate numeric not null,
  premium numeric,
  interval_hours int not null default 1,
  created_at timestamptz not null default now(),
  unique (coin, ts, interval_hours)
);

create index funding_rates_coin_ts_idx
  on public.funding_rates (coin, ts desc);

alter table public.funding_rates enable row level security;

create policy funding_rates_select on public.funding_rates
  for select
  to authenticated
  using (true);

notify pgrst, 'reload schema';
