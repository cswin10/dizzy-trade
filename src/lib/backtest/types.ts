// Shared types for the backtest engine. The engine simulates running
// a strategy over historical candle data and produces both per-trade
// results and aggregate metrics. Types here are referenced by the
// engine, the metrics module, the server actions, and the UI.

import type { StrategyDefinition } from '@/lib/strategies/types'

export const BACKTEST_TIMEFRAMES = [
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  '1d',
] as const

export type BacktestTimeframe = (typeof BACKTEST_TIMEFRAMES)[number]

export type BacktestCandle = {
  pair: string
  timeframe: string
  candle_open_at: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// A backtest is sourced from exactly one strategy: either a legacy
// hardcoded framework, or a composable strategy_definition (the
// JSON document validated by src/lib/strategies/schema.ts). The
// engine dispatches on which one is present at run time. The two
// halves are kept on the same flat type so the existing fee /
// slippage / risk fields are shared.
export type BacktestConfig = {
  // Legacy path. framework_id and framework_thresholds are set
  // together when a backtest targets one of the hardcoded
  // frameworks (e.g. simple_rsi_v1, mean_reversion_v1).
  framework_id?: string
  framework_thresholds?: Record<string, number>

  // Composable path. strategy_definition_id is the source of
  // truth in the database; the engine itself only reads
  // strategy_definition_snapshot, which the action layer
  // populates from the snapshot column on backtest_runs. This
  // keeps the engine immune to upstream edits / deletes of the
  // live definition row.
  strategy_definition_id?: string
  strategy_definition_snapshot?: StrategyDefinition

  timeframe: BacktestTimeframe
  pairs: string[]
  risk_amount_gbp: number
  min_rr: number
  max_concurrent_positions: number
  max_daily_loss_gbp: number | null
  max_consecutive_losers: number | null
  date_range_start: Date
  date_range_end: Date
  slippage_pct: number
  maker_fee_pct: number
  taker_fee_pct: number
  assume_taker: boolean
}

export type BacktestStrategySource = 'framework' | 'strategy_definition'

export function backtestSource(config: BacktestConfig): BacktestStrategySource {
  if (config.strategy_definition_snapshot || config.strategy_definition_id) {
    return 'strategy_definition'
  }
  return 'framework'
}

export type SimulatedTradeExitReason =
  | 'target_hit'
  | 'stop_hit'
  | 'timeout'
  | 'rules_blocked'
  | 'open_at_period_end'

export type SimulatedTradeOutcome = 'win' | 'loss' | 'breakeven'

export type SimulatedTrade = {
  pair: string
  direction: 'long' | 'short'
  entry_at: Date
  entry_price: number
  stop_price: number
  target_price: number
  exit_at: Date | null
  exit_price: number | null
  exit_reason: SimulatedTradeExitReason
  size_coin: number
  size_usd: number
  pnl_usd: number
  pnl_gbp: number
  r_multiple: number
  outcome: SimulatedTradeOutcome
  conditions_at_signal: Record<string, unknown>
}

// Per-pair counters captured during a run. Always present in the
// diagnostics payload, even when a pair produced zero signals.
export type BacktestDiagnosticsPair = {
  candles_loaded: number
  candles_evaluated: number
  long_evaluations: number
  short_evaluations: number
  signals: number
}

// Structured "what happened" report attached to every backtest run.
// The UI uses it to explain zero-signal results without making the
// operator squint at jsonb. Always populated (even on zero-signal
// or zero-trade runs); never holds undefined fields.
export type BacktestDiagnostics = {
  // Warmup window the engine actually used for this run. For
  // composable strategies this is the dynamic value computed from
  // the strategy's lookbacks; for legacy frameworks it is the fixed
  // 60. Compared against warmup_param_max in the UI to flag
  // strategies whose indicators outsize the warmup.
  warmup_candles_used: number
  // The largest indicator-lookback param found in the strategy
  // definition (period, lookback, slow_period, etc.). Zero for
  // legacy frameworks, since the engine does not introspect them.
  warmup_param_max: number

  per_pair: Record<string, BacktestDiagnosticsPair>

  evaluations_total: number
  evaluations_passed: number
  evaluations_blocked_by_rules: number

  // {condition_type: count} aggregated across every short-circuited
  // failing condition seen during the run. Reveals which condition
  // is the bottleneck of an AND-group.
  condition_failure_breakdown: Record<string, number>
  // Subset of condition_failure_breakdown for failures attributed
  // to insufficient data (NaN indicators, "not enough candles" etc.).
  // Smoking gun for warmup misconfig.
  condition_insufficient_data: Record<string, number>

  first_signal_at: string | null
  last_signal_at: string | null
  // Source of the diagnostics, kept in case we add a sampling
  // optimisation later. 'full' means every evaluation was counted.
  sample_rate: number
}

export type RunBacktestResult = {
  trades: SimulatedTrade[]
  signals_total: number
  signals_blocked_by_rules: number
  gbp_usd_rate_used: number
  diagnostics: BacktestDiagnostics
}

export type BacktestMetrics = {
  total_trades: number
  wins: number
  losses: number
  breakevens: number
  win_rate: number
  avg_r: number
  total_pnl_gbp: number
  max_drawdown_gbp: number
  max_drawdown_pct: number
  sharpe_ratio: number
  longest_losing_streak: number
  expectancy_per_trade_gbp: number
}

// Number of candles per timeframe to keep a position open before
// closing on timeout. Tuned so every timeframe roughly matches
// 4 calendar days of price action: enough rope for a setup to play
// out, short enough that a forgotten trade does not skew metrics.
export const TIMEOUT_CANDLES: Record<BacktestTimeframe, number> = {
  '1m': 5760,
  '5m': 1152,
  '15m': 384,
  '30m': 192,
  '1h': 96,
  '4h': 24,
  '1d': 7,
}

// How many candles of trailing context the framework needs to make a
// signal decision. Set high enough to cover the longest indicator any
// framework reads (e.g. swing detection at 50 candles). Frameworks
// short-circuit with conditionValues.candleCount when they have less.
export const FRAMEWORK_WARMUP_CANDLES = 60

// Milliseconds per candle for each supported timeframe. Drives the
// chunking logic in the candle fetcher and the timeout check in the
// engine.
export const TIMEFRAME_MS: Record<BacktestTimeframe, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
}
