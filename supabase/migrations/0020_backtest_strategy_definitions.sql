-- Composable strategy definitions inside the backtest engine.
--
-- Until now a backtest_runs row was bound to a hardcoded framework
-- via framework_id. The composable strategy system (prompts 20a/b)
-- introduced a second source of strategies, stored as JSON in
-- public.strategy_definitions and evaluated by a registry-driven
-- engine. This migration teaches backtest_runs how to point at one
-- of those instead of (or in addition to) a framework.
--
-- Two new columns:
--   strategy_definition_id        the source of truth for strategy
--                                 lookups while the run is still
--                                 attached to a live definition.
--   strategy_definition_snapshot  the JSON document at run time, so
--                                 deleting or editing the source
--                                 row does not retroactively change
--                                 historical backtest results. The
--                                 engine reads from this column at
--                                 execute time, never from the live
--                                 strategy_definitions row.
--
-- framework_id becomes nullable: a run uses one or the other, never
-- both, never neither. A CHECK constraint enforces the discriminator
-- without needing application-level guards.

alter table public.backtest_runs
  add column if not exists strategy_definition_id uuid
    references public.strategy_definitions(id) on delete set null,
  add column if not exists strategy_definition_snapshot jsonb;

alter table public.backtest_runs
  alter column framework_id drop not null;

alter table public.backtest_runs
  drop constraint if exists backtest_runs_strategy_source_check;

alter table public.backtest_runs
  add constraint backtest_runs_strategy_source_check
    check (
      (framework_id is not null and strategy_definition_id is null)
      or
      (framework_id is null and strategy_definition_id is not null)
    );

create index if not exists backtest_runs_strategy_definition_idx
  on public.backtest_runs (strategy_definition_id)
  where strategy_definition_id is not null;
