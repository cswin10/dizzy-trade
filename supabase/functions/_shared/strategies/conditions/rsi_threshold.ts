import { rsi } from '../../technical.ts'

import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

import { compareAll } from './_helpers.ts'

const TYPE = 'rsi_threshold'

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    period: number
    comparator: 'lt' | 'lte' | 'gt' | 'gte'
    value: number
  }
  const closes = context.candles.map((c) => c.c)
  const value = rsi(closes, params.period)
  return {
    passed: compareAll(value, params.comparator, params.value),
    values: { rsi: value },
  }
})
