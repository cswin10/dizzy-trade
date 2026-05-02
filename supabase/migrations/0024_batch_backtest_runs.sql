-- Batch backtest comparisons.
--
-- A batch backtest groups N individual backtest_runs under a single
-- shared config so the operator can compare strategies head-to-head
-- on the same period, pairs, fees and slippage. Each child run is
-- still a normal backtest_runs row (the engine is untouched); the
-- new batch_run_id foreign key links them back to the parent batch
-- so the leaderboard query can find them in one shot.
--
-- RLS pattern matches the rest of the schema: tenant_id +
-- public.current_tenant_id() helper, full CRUD for the owner. The
-- backtest_runs.batch_run_id column is nullable and only set when
-- a row is materialised by the batch orchestrator.

create table public.batch_backtest_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  -- Shared config snapshot at create time. Holds the common fields
  -- the orchestrator passes through to each child run: pairs,
  -- timeframe, date_range_start / end, starting_capital_gbp,
  -- maker_fee_pct, taker_fee_pct, slippage_pct, assume_taker, plus
  -- the use_strategy_native_pairs toggle.
  config jsonb not null,
  -- The strategies in this batch. Two arrays so the orchestrator
  -- can dispatch each id to the right path (composable vs legacy).
  strategy_definition_ids uuid[] not null default '{}',
  legacy_strategy_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text
);

create index batch_backtest_runs_tenant_idx
  on public.batch_backtest_runs (tenant_id, created_at desc);

alter table public.batch_backtest_runs enable row level security;

create policy batch_backtest_runs_select on public.batch_backtest_runs
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy batch_backtest_runs_insert on public.batch_backtest_runs
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

create policy batch_backtest_runs_update on public.batch_backtest_runs
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy batch_backtest_runs_delete on public.batch_backtest_runs
  for delete
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- Link each child backtest_runs row back to its parent batch.
-- Nullable so single backtest runs (the existing flow) stay
-- unaffected. on delete set null so deleting a batch leaves the
-- underlying runs intact for archival.
alter table public.backtest_runs
  add column if not exists batch_run_id uuid
    references public.batch_backtest_runs(id) on delete set null;

create index if not exists backtest_runs_batch_idx
  on public.backtest_runs (batch_run_id)
  where batch_run_id is not null;
