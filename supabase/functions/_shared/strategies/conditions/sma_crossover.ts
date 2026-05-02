import { sma } from '../../technical.ts'

import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

const TYPE = 'sma_crossover'

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    fast_period: number
    slow_period: number
    direction: 'fast_crossing_above_slow' | 'fast_crossing_below_slow'
  }
  const closes = context.candles.map((c) => c.c)
  if (closes.length < 2) {
    return { passed: false, values: { reason: 'not enough candles' } }
  }
  const fast = sma(closes, params.fast_period)
  const slow = sma(closes, params.slow_period)
  const fastPrev = sma(closes.slice(0, -1), params.fast_period)
  const slowPrev = sma(closes.slice(0, -1), params.slow_period)
  if (![fast, slow, fastPrev, slowPrev].every(Number.isFinite)) {
    return {
      passed: false,
      values: { fast, slow, fastPrev, slowPrev, reason: 'not enough candles' },
    }
  }
  const crossingAbove = fastPrev <= slowPrev && fast > slow
  const crossingBelow = fastPrev >= slowPrev && fast < slow
  const passed =
    params.direction === 'fast_crossing_above_slow'
      ? crossingAbove
      : crossingBelow
  return { passed, values: { fast, slow, fastPrev, slowPrev } }
})
