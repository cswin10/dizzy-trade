-- Backtest engine schema.
--
-- Three tables:
--
--   backtest_runs    one row per backtest, holds the snapshot of the
--                    strategy config used and the aggregate metrics that
--                    came out of it. The strategy config is denormalised
--                    on purpose: deleting or editing the live strategy
--                    must not change historical backtest results.
--
--   backtest_trades  trade-by-trade output of a run, including signals
--                    that were blocked by rules so the operator can see
--                    what discipline cost. Linked back to the run via
--                    on delete cascade so deleting a run cleans up its
--                    trades automatically.
--
--   backtest_candles cache for Hyperliquid candle data. Shared across
--                    all tenants because it is just public market data,
--                    no need to duplicate it per tenant.
--
-- RLS is enabled on backtest_runs and backtest_trades scoped by tenant.
-- backtest_candles has RLS enabled with a permissive read policy for
-- authenticated users (writes go through the service role from the
-- engine, which bypasses RLS).

-- Runs ----------------------------------------------------------------

create table public.backtest_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),

  -- Strategy snapshot at run time.
  framework_id text not null,
  framework_thresholds jsonb not null,
  timeframe text not null,
  pairs text[] not null,

  -- Risk config snapshot.
  risk_amount_gbp numeric not null,
  min_rr numeric not null,
  max_concurrent_positions integer not null,
  max_daily_loss_gbp numeric,
  max_consecutive_losers integer,

  -- Backtest config.
  date_range_start timestamptz not null,
  date_range_end timestamptz not null,
  slippage_pct numeric not null default 0.05,
  maker_fee_pct numeric not null default 0.015,
  taker_fee_pct numeric not null default 0.045,
  assume_taker boolean not null default true,
  enable_train_test_split boolean not null default true,
  train_split_pct numeric not null default 70,

  -- Run lifecycle.
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  error_message text,
  run_started_at timestamptz,
  run_completed_at timestamptz,

  -- Aggregate metrics, full period.
  total_signals integer,
  total_trades integer,
  wins integer,
  losses integer,
  breakevens integer,
  win_rate numeric,
  avg_r numeric,
  total_pnl_gbp numeric,
  max_drawdown_gbp numeric,
  max_drawdown_pct numeric,
  sharpe_ratio numeric,
  longest_losing_streak integer,
  expectancy_per_trade_gbp numeric,

  -- Train/test split.
  train_metrics jsonb,
  test_metrics jsonb,
  overfit_warning_triggered boolean,

  gbp_usd_rate_used numeric
);

create index backtest_runs_tenant_created_idx
  on public.backtest_runs (tenant_id, created_at desc);

alter table public.backtest_runs enable row level security;

create policy backtest_runs_select on public.backtest_runs
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy backtest_runs_insert on public.backtest_runs
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

create policy backtest_runs_update on public.backtest_runs
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy backtest_runs_delete on public.backtest_runs
  for delete
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- Trades --------------------------------------------------------------

create table public.backtest_trades (
  id uuid primary key default gen_random_uuid(),
  backtest_run_id uuid not null
    references public.backtest_runs(id) on delete cascade,
  pair text not null,
  direction text not null check (direction in ('long', 'short')),
  entry_at timestamptz not null,
  entry_price numeric not null,
  stop_price numeric not null,
  target_price numeric not null,
  exit_at timestamptz,
  exit_price numeric,
  exit_reason text check (
    exit_reason in (
      'target_hit',
      'stop_hit',
      'timeout',
      'rules_blocked',
      'open_at_period_end'
    )
  ),
  size_coin numeric not null,
  size_usd numeric not null,
  pnl_usd numeric,
  pnl_gbp numeric,
  r_multiple numeric,
  outcome text check (outcome in ('win', 'loss', 'breakeven')),
  in_train_period boolean,
  conditions_at_signal jsonb,
  gbp_usd_rate_used numeric
);

create index backtest_trades_run_entry_idx
  on public.backtest_trades (backtest_run_id, entry_at);

create index backtest_trades_run_outcome_idx
  on public.backtest_trades (backtest_run_id, outcome);

alter table public.backtest_trades enable row level security;

-- backtest_trades inherits tenant scoping through its parent run. The
-- policy joins on backtest_runs so the caller can only see trades that
-- belong to a run inside their tenant.
create policy backtest_trades_select on public.backtest_trades
  for select
  to authenticated
  using (
    exists (
      select 1 from public.backtest_runs r
      where r.id = backtest_trades.backtest_run_id
        and r.tenant_id = public.current_tenant_id()
    )
  );

create policy backtest_trades_insert on public.backtest_trades
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.backtest_runs r
      where r.id = backtest_trades.backtest_run_id
        and r.tenant_id = public.current_tenant_id()
    )
  );

create policy backtest_trades_delete on public.backtest_trades
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.backtest_runs r
      where r.id = backtest_trades.backtest_run_id
        and r.tenant_id = public.current_tenant_id()
    )
  );

-- Candles cache -------------------------------------------------------

create table public.backtest_candles (
  id uuid primary key default gen_random_uuid(),
  pair text not null,
  timeframe text not null,
  candle_open_at timestamptz not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null,
  unique (pair, timeframe, candle_open_at)
);

create index backtest_candles_lookup_idx
  on public.backtest_candles (pair, timeframe, candle_open_at);

alter table public.backtest_candles enable row level security;

-- Public market data: any authenticated caller can read. Writes go
-- through the service role from the engine, which bypasses RLS.
create policy backtest_candles_select on public.backtest_candles
  for select
  to authenticated
  using (true);
