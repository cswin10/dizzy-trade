import { sma } from '../../technical.ts'

import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

import { compareAll } from './_helpers.ts'

const TYPE = 'sma_distance'

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    period: number
    comparator: 'lt' | 'lte' | 'gt' | 'gte'
    distance_pct: number
    side: 'above' | 'below' | 'absolute'
  }
  const value = sma(
    context.candles.map((c) => c.c),
    params.period,
  )
  if (!Number.isFinite(value) || value <= 0) {
    return { passed: false, values: { reason: 'no sma' } }
  }
  const close = context.currentPrice
  let raw: number
  if (params.side === 'above') raw = close - value
  else if (params.side === 'below') raw = value - close
  else raw = Math.abs(close - value)
  const distancePct = (raw / value) * 100
  return {
    passed: compareAll(distancePct, params.comparator, params.distance_pct),
    values: { sma: value, distance_pct: distancePct },
  }
})
