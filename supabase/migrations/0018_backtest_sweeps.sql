-- Backtest parameter sweeps.
--
-- A sweep is a collection of backtests that share a base config and
-- vary a small set of parameters across a cartesian product of values.
-- Each combination is materialised as a row in `backtest_runs` so the
-- existing engine, results dashboard, and metrics code all keep
-- working without modification.
--
-- backtest_sweeps holds the orchestration state: the dimension
-- definitions, total combination count, lifecycle status, and a
-- progress counter the client uses to drive polling. Individual
-- combination rows in backtest_runs gain three new columns linking
-- them back to the parent sweep and recording which combination they
-- represent.
--
-- RLS: tenant-scoped on backtest_sweeps. backtest_runs already
-- carries tenant_id and is policy-protected.

create table public.backtest_sweeps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),

  -- Base config (the parts that do not sweep). Pair list and date
  -- range are fixed per sweep so the candle cache is hit by the
  -- first combination and reused by all the rest.
  framework_id text not null,
  timeframe text not null,
  pairs text[] not null,
  date_range_start timestamptz not null,
  date_range_end timestamptz not null,
  max_concurrent_positions integer not null,
  max_daily_loss_gbp numeric,
  max_consecutive_losers integer,
  slippage_pct numeric not null,
  maker_fee_pct numeric not null,
  taker_fee_pct numeric not null,
  assume_taker boolean not null,
  enable_train_test_split boolean not null,
  train_split_pct numeric not null,

  -- Sweep definition. sweep_dimensions is an array of objects of
  -- shape { key, type, ... } where type is 'range' | 'enum' |
  -- 'boolean'. The orchestrator expands these to a cartesian product
  -- and pre-creates one backtest_runs row per combination.
  sweep_dimensions jsonb not null,
  total_combinations integer not null,

  -- Lifecycle.
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  combinations_completed integer not null default 0,
  combinations_failed integer not null default 0,
  run_started_at timestamptz,
  run_completed_at timestamptz,
  error_message text
);

create index backtest_sweeps_tenant_created_idx
  on public.backtest_sweeps (tenant_id, created_at desc);

alter table public.backtest_sweeps enable row level security;

create policy backtest_sweeps_select on public.backtest_sweeps
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy backtest_sweeps_insert on public.backtest_sweeps
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

create policy backtest_sweeps_update on public.backtest_sweeps
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy backtest_sweeps_delete on public.backtest_sweeps
  for delete
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- backtest_runs gains a back-reference to the owning sweep, the
-- combination index it represents, and a snapshot of the swept
-- values that produced its config. The 'cancelled' state is a new
-- terminal status for combinations whose parent sweep was cancelled
-- before they got a chance to run.
alter table public.backtest_runs
  add column if not exists sweep_id uuid
    references public.backtest_sweeps(id) on delete cascade,
  add column if not exists sweep_combination_index integer,
  add column if not exists sweep_combination_values jsonb;

alter table public.backtest_runs
  drop constraint if exists backtest_runs_status_check;

alter table public.backtest_runs
  add constraint backtest_runs_status_check
    check (status in ('pending', 'running', 'completed', 'failed', 'cancelled'));

create index if not exists backtest_runs_sweep_idx
  on public.backtest_runs (sweep_id, sweep_combination_index);
