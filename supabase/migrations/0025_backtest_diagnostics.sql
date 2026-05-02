-- Backtest diagnostics column.
--
-- Every backtest run now produces a structured diagnostic report
-- explaining what the engine did during the run: how many
-- evaluations happened per pair, which conditions blocked signals
-- (and how many of those failures were attributed to insufficient
-- candle history vs threshold-not-met), the warmup window used vs
-- the strategy's largest indicator lookback, etc.
--
-- The shape lives in src/lib/backtest/types.ts as BacktestDiagnostics.
-- We persist it as jsonb so the UI can render whatever fields are
-- present without a schema migration each time the diagnostic shape
-- evolves.
--
-- Nullable: a run that pre-dates this migration has no diagnostics,
-- and the UI is expected to fall back to the existing summary
-- columns rather than crashing.

alter table public.backtest_runs
  add column if not exists diagnostics jsonb;

-- No new RLS policies needed: diagnostics is just another column on
-- backtest_runs and inherits the existing tenant-scoped policies.
