import { ema } from '../../technical.ts'

import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

const TYPE = 'ema_position'

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    period: number
    position: 'above' | 'below'
  }
  const value = ema(
    context.candles.map((c) => c.c),
    params.period,
  )
  if (!Number.isFinite(value)) {
    return { passed: false, values: { reason: 'not enough candles' } }
  }
  const close = context.currentPrice
  const passed = params.position === 'above' ? close > value : close < value
  return { passed, values: { ema: value, close } }
})
