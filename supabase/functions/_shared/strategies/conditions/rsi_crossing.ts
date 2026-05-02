import { rsi } from '../../technical.ts'

import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

const TYPE = 'rsi_crossing'

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    period: number
    direction: 'crossing_below' | 'crossing_above'
    value: number
  }
  const closes = context.candles.map((c) => c.c)
  if (closes.length < 2) {
    return { passed: false, values: { reason: 'not enough candles' } }
  }
  const current = rsi(closes, params.period)
  const previous = rsi(closes.slice(0, -1), params.period)
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return { passed: false, values: { current, previous } }
  }
  const crossingBelow = previous >= params.value && current < params.value
  const crossingAbove = previous <= params.value && current > params.value
  const passed =
    params.direction === 'crossing_below' ? crossingBelow : crossingAbove
  return { passed, values: { current, previous } }
})
