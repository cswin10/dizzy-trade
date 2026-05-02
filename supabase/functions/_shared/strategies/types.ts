// Composable strategy types.
//
// A strategy definition is a JSON document describing entry, exit,
// and sizing for a trading strategy. Conditions inside an entry
// group are AND-ed; groups are OR-ed against each other so a single
// strategy can express several distinct setups (e.g. a long setup
// and a short setup, or two different long setups).
//
// Condition shapes are open-ended on purpose. Each Condition.type
// names an evaluator registered in the evaluator engine; the
// evaluator owns its parameter schema and its evaluation logic.
// Adding a new condition type is a matter of writing the evaluator
// and the matching zod schema and registering them, no edits to
// these types or the engine core.

import type { Candle } from '../hyperliquid.ts'

export type StrategyDirection = 'long_only' | 'short_only' | 'both'

export type Condition = {
  type: string
  params: Record<string, unknown>
}

export type EntryGroup = {
  // Required even on 'both' strategies so each group declares which
  // direction it is testing for. Mixing long and short conditions
  // inside one group is meaningless; this field forces the
  // disambiguation up front.
  direction: 'long' | 'short'
  conditions: Condition[]
}

export type StopRule =
  | { type: 'fixed_pct'; pct: number }
  | { type: 'atr_multiple'; period: number; multiple: number }
  | { type: 'recent_swing'; lookback_candles: number; buffer_pct?: number }

export type TargetRule =
  | { type: 'fixed_pct'; pct: number }
  | { type: 'fixed_rr'; rr: number }
  | { type: 'atr_multiple'; period: number; multiple: number }

export type SizingRule =
  | { type: 'fixed_gbp_risk'; amount: number }
  | { type: 'fixed_position_size'; size: number }

export type StrategyDefinition = {
  schema_version: 1
  name: string
  description?: string
  direction: StrategyDirection
  entry: {
    groups: EntryGroup[]
  }
  exit: {
    stop: StopRule
    target: TargetRule
    timeout_candles?: number
  }
  sizing: SizingRule
  metadata?: Record<string, unknown>
}

// Runtime context handed to the evaluator when it walks a candle.
// candles ends with currentCandle: backtest semantics treat the
// current bar's close as the decision point, so anything beyond
// candles[candles.length - 1] would be lookahead.
export type EvaluationContext = {
  candles: Candle[]
  currentCandle: Candle
  currentPrice: number
  funding?: number
  openInterest?: number
}

export type ConditionEvaluationResult = {
  passed: boolean
  // Free-form values surfaced for debugging and for the
  // conditions_at_signal column on backtest_trades / alerts.
  values?: Record<string, unknown>
}

export type EvaluationResult = {
  triggered: boolean
  direction?: 'long' | 'short'
  entry_price?: number
  stop_price?: number
  target_price?: number
  triggered_group_index?: number
  condition_values: Record<string, unknown>
}
