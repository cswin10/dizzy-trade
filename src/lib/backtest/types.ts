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

export type RunBacktestResult = {
  trades: SimulatedTrade[]
  signals_total: number
  signals_blocked_by_rules: number
  gbp_usd_rate_used: number
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
