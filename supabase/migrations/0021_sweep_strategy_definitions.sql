-- Composable strategy definitions inside parameter sweeps.
--
-- Mirrors 0020 for the sweep table. A sweep targets either a
-- framework (legacy) or a strategy_definition (composable). When
-- composable, sweep_dimensions are JSON-path-based instead of
-- framework-key-based; the orchestrator applies each combination
-- to the snapshot to produce a per-run strategy variant.
--
-- The sweep itself snapshots the source definition once at create
-- time so deleting the source row does not break a still-running
-- or already-finished sweep.

alter table public.backtest_sweeps
  add column if not exists strategy_definition_id uuid
    references public.strategy_definitions(id) on delete set null,
  add column if not exists strategy_definition_snapshot jsonb;

alter table public.backtest_sweeps
  alter column framework_id drop not null;

alter table public.backtest_sweeps
  drop constraint if exists backtest_sweeps_strategy_source_check;

alter table public.backtest_sweeps
  add constraint backtest_sweeps_strategy_source_check
    check (
      (framework_id is not null and strategy_definition_id is null)
      or
      (framework_id is null and strategy_definition_id is not null)
    );

create index if not exists backtest_sweeps_strategy_definition_idx
  on public.backtest_sweeps (strategy_definition_id)
  where strategy_definition_id is not null;
