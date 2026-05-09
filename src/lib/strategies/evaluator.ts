// Strategy evaluator engine.
//
// Walks a validated StrategyDefinition against a single
// EvaluationContext (the latest candle plus its trailing window).
// Returns whether a signal fires, which group fired, and the
// computed entry / stop / target prices.
//
// The engine is registry-driven. Condition evaluators, stop
// evaluators, and target evaluators register themselves at module
// load via the helpers exported below; the engine never knows
// which conditions exist. This keeps the engine stable while the
// condition library evolves.
//
// 20a registers only the simplest stop and target evaluators
// (fixed_pct stop, fixed_pct / fixed_rr target) plus the empty
// condition list case. The full library lands in 20b.

import type { Candle } from '@/lib/hyperliquid'

import type {
  Condition,
  ConditionEvaluationResult,
  EvaluationContext,
  EvaluationResult,
  SizingRule,
  StopRule,
  StrategyDefinition,
  TargetRule,
} from './types'

// --- Registries -------------------------------------------------

type ConditionEvaluator = (
  condition: Condition,
  context: EvaluationContext,
  direction: 'long' | 'short',
) => ConditionEvaluationResult

type StopEvaluator = (
  rule: StopRule,
  context: EvaluationContext,
  direction: 'long' | 'short',
  entryPrice: number,
) => number

type TargetEvaluator = (
  rule: TargetRule,
  context: EvaluationContext,
  direction: 'long' | 'short',
  entryPrice: number,
  stopPrice: number,
) => number

type SizingComputer = (
  rule: SizingRule,
  riskPriceDistance: number,
  entryPrice: number,
  gbpUsdRate: number,
) => { sizeCoin: number; sizeUsd: number }

const conditionEvaluators = new Map<string, ConditionEvaluator>()
const stopEvaluators = new Map<string, StopEvaluator>()
const targetEvaluators = new Map<string, TargetEvaluator>()
const sizingComputers = new Map<string, SizingComputer>()

export function registerConditionEvaluator(
  type: string,
  fn: ConditionEvaluator,
): void {
  conditionEvaluators.set(type, fn)
}

export function registerStopEvaluator(type: string, fn: StopEvaluator): void {
  stopEvaluators.set(type, fn)
}

export function registerTargetEvaluator(
  type: string,
  fn: TargetEvaluator,
): void {
  targetEvaluators.set(type, fn)
}

export function registerSizingComputer(type: string, fn: SizingComputer): void {
  sizingComputers.set(type, fn)
}

// --- Built-in stop/target/sizing evaluators ---------------------

// Pulls the stop a fixed percentage below (long) or above (short)
// the entry. Smallest possible useful evaluator and the one the
// stub fixture exercises.
registerStopEvaluator('fixed_pct', (rule, _ctx, direction, entryPrice) => {
  if (rule.type !== 'fixed_pct') {
    throw new Error('fixed_pct stop evaluator received wrong rule type')
  }
  const factor = rule.pct / 100
  return direction === 'long'
    ? entryPrice * (1 - factor)
    : entryPrice * (1 + factor)
})

registerTargetEvaluator('fixed_pct', (rule, _ctx, direction, entryPrice) => {
  if (rule.type !== 'fixed_pct') {
    throw new Error('fixed_pct target evaluator received wrong rule type')
  }
  const factor = rule.pct / 100
  return direction === 'long'
    ? entryPrice * (1 + factor)
    : entryPrice * (1 - factor)
})

// fixed_rr targets the entry plus N times the stop distance, on the
// opposite side of the stop. Mirror logic for shorts. Encodes the
// "1:N risk/reward" idea precisely.
registerTargetEvaluator(
  'fixed_rr',
  (rule, _ctx, direction, entryPrice, stopPrice) => {
    if (rule.type !== 'fixed_rr') {
      throw new Error('fixed_rr target evaluator received wrong rule type')
    }
    const risk = Math.abs(entryPrice - stopPrice)
    return direction === 'long'
      ? entryPrice + risk * rule.rr
      : entryPrice - risk * rule.rr
  },
)

registerSizingComputer(
  'fixed_gbp_risk',
  (rule, riskPriceDistance, entryPrice, gbpUsdRate) => {
    if (rule.type !== 'fixed_gbp_risk') {
      throw new Error('fixed_gbp_risk computer received wrong rule type')
    }
    if (riskPriceDistance <= 0) return { sizeCoin: 0, sizeUsd: 0 }
    const riskUsd = rule.amount * gbpUsdRate
    const sizeCoin = riskUsd / riskPriceDistance
    return { sizeCoin, sizeUsd: sizeCoin * entryPrice }
  },
)

registerSizingComputer('fixed_position_size', (rule, _risk, entryPrice) => {
  if (rule.type !== 'fixed_position_size') {
    throw new Error('fixed_position_size computer received wrong rule type')
  }
  return { sizeCoin: rule.size, sizeUsd: rule.size * entryPrice }
})

// --- Engine -----------------------------------------------------

function evaluateCondition(
  condition: Condition,
  context: EvaluationContext,
  direction: 'long' | 'short',
): ConditionEvaluationResult {
  const evaluator = conditionEvaluators.get(condition.type)
  if (!evaluator) {
    throw new Error(
      `No evaluator registered for condition type "${condition.type}". ` +
        'Register it via registerConditionEvaluator before evaluating a ' +
        'strategy that uses it.',
    )
  }
  return evaluator(condition, context, direction)
}

function evaluateStop(
  rule: StopRule,
  context: EvaluationContext,
  direction: 'long' | 'short',
  entryPrice: number,
): number {
  const evaluator = stopEvaluators.get(rule.type)
  if (!evaluator) {
    throw new Error(`No evaluator registered for stop rule type "${rule.type}"`)
  }
  return evaluator(rule, context, direction, entryPrice)
}

function evaluateTarget(
  rule: TargetRule,
  context: EvaluationContext,
  direction: 'long' | 'short',
  entryPrice: number,
  stopPrice: number,
): number {
  const evaluator = targetEvaluators.get(rule.type)
  if (!evaluator) {
    throw new Error(
      `No evaluator registered for target rule type "${rule.type}"`,
    )
  }
  return evaluator(rule, context, direction, entryPrice, stopPrice)
}

export function computePositionSize(
  rule: SizingRule,
  riskPriceDistance: number,
  entryPrice: number,
  gbpUsdRate: number,
): { sizeCoin: number; sizeUsd: number } {
  const computer = sizingComputers.get(rule.type)
  if (!computer) {
    throw new Error(
      `No computer registered for sizing rule type "${rule.type}"`,
    )
  }
  return computer(rule, riskPriceDistance, entryPrice, gbpUsdRate)
}

export function evaluateStrategy(
  definition: StrategyDefinition,
  context: EvaluationContext,
): EvaluationResult {
  const conditionValues: Record<string, unknown> = {}
  // Captures, per group, the condition that caused the group to
  // fail. Lazy-allocated so triggered runs don't pay for it.
  let groupFailures: EvaluationResult['group_failures']

  for (let gi = 0; gi < definition.entry.groups.length; gi++) {
    const group = definition.entry.groups[gi]!
    let allPassed = true

    if (group.conditions.length === 0) {
      // An empty condition list is always-true. Useful for stub
      // strategies and for "always enter on this candle" probes
      // during engine bring-up.
      allPassed = true
    } else {
      for (let ci = 0; ci < group.conditions.length; ci++) {
        const condition = group.conditions[ci]!
        const result = evaluateCondition(condition, context, group.direction)
        if (result.values) {
          for (const [key, value] of Object.entries(result.values)) {
            conditionValues[`group_${gi}.${condition.type}.${key}`] = value
          }
        }
        if (!result.passed) {
          // Reasons like 'not enough candles' / 'no sma' / 'no atr'
          // / 'not enough atr history' are surfaced by the condition
          // library when an indicator could not be computed (NaN).
          // Treat any reason starting with "not enough" or matching
          // those known phrases as insufficient_data; everything
          // else is a "real" failure (threshold not crossed, wrong
          // side of EMA, etc.).
          const reason = result.values?.reason
          const insufficientData =
            typeof reason === 'string' &&
            (reason.startsWith('not enough') ||
              reason === 'no sma' ||
              reason === 'no atr' ||
              reason === 'no reference' ||
              reason === 'no funding data')
          if (!groupFailures) groupFailures = []
          groupFailures.push({
            group_index: gi,
            condition_index: ci,
            condition_type: condition.type,
            insufficient_data: insufficientData,
          })
          allPassed = false
          break
        }
      }
    }

    if (!allPassed) continue

    // Group fired. Compute prices and return.
    const direction = group.direction
    const entryPrice = context.currentPrice
    const stopPrice = evaluateStop(
      definition.exit.stop,
      context,
      direction,
      entryPrice,
    )
    const targetPrice = evaluateTarget(
      definition.exit.target,
      context,
      direction,
      entryPrice,
      stopPrice,
    )
    return {
      triggered: true,
      direction,
      entry_price: entryPrice,
      stop_price: stopPrice,
      target_price: targetPrice,
      triggered_group_index: gi,
      condition_values: conditionValues,
    }
  }

  return {
    triggered: false,
    condition_values: conditionValues,
    ...(groupFailures ? { group_failures: groupFailures } : {}),
  }
}

// Re-export Candle type for external consumers building an
// EvaluationContext without importing the hyperliquid module
// directly.
export type { Candle }
