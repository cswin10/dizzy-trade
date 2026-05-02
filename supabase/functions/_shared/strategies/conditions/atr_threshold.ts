import { atr } from '../../technical.ts'

import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

import { compareAll } from './_helpers.ts'

const TYPE = 'atr_threshold'

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    period: number
    comparator: 'lt' | 'lte' | 'gt' | 'gte'
    value: number
  }
  const value = atr(context.candles, params.period)
  return {
    passed: compareAll(value, params.comparator, params.value),
    values: { atr: value },
  }
})
