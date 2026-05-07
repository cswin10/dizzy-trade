-- Walk-forward backtesting.
--
-- A walk-forward run is the parent of N child backtest_runs, each
-- exercising the same strategy over a rolling time window. The
-- aggregate is what the operator looks at: "did the strategy
-- print money in 7 of 10 windows, or just 1 outlier with 9
-- losers?". Storing the parent + the child run ids keeps each
-- window inspectable via the existing /backtest/[run_id] page.
--
-- Pure parent table; child rows live in the existing
-- public.backtest_runs (the engine is unchanged). Linked by an
-- array of child ids so the relationship is one-way and the
-- backtest_runs table needs no new column.

create table public.walk_forward_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_id uuid not null
    references public.strategy_definitions(id) on delete cascade,

  -- Snapshot of the inputs that produced the run. Includes pairs,
  -- timeframe, total_start, total_end, risk, fees, slippage, plus
  -- the window / step parameters. Stored as jsonb so the shape can
  -- evolve without a migration.
  parent_config jsonb not null,
  window_size_days int not null,
  step_size_days int not null,

  status text not null default 'queued'
    check (status in ('queued', 'running', 'complete', 'failed')),

  -- Child run ids in chronological order. Updated as the runner
  -- progresses through windows; a row with status='running' may
  -- have a partial array.
  child_run_ids uuid[] not null default '{}',

  -- Aggregated metrics computed when the parent transitions to
  -- 'complete'. Shape mirrors what the UI renders; see the
  -- companion server action for the exact keys.
  summary jsonb,

  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index walk_forward_runs_tenant_idx
  on public.walk_forward_runs (tenant_id, created_at desc);

alter table public.walk_forward_runs enable row level security;

create policy walk_forward_runs_select on public.walk_forward_runs
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy walk_forward_runs_insert on public.walk_forward_runs
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

create policy walk_forward_runs_update on public.walk_forward_runs
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy walk_forward_runs_delete on public.walk_forward_runs
  for delete to authenticated
  using (tenant_id = public.current_tenant_id());

notify pgrst, 'reload schema';
