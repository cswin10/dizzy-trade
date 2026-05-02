import { stochastic } from '../../technical.ts'

import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

import { compareAll } from './_helpers.ts'

const TYPE = 'stochastic_threshold'

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    k_period: number
    d_period: number
    smooth: number
    line: 'k' | 'd'
    comparator: 'lt' | 'lte' | 'gt' | 'gte'
    value: number
  }
  const result = stochastic(
    context.candles,
    params.k_period,
    params.d_period,
    params.smooth,
  )
  if (!result) {
    return { passed: false, values: { reason: 'not enough candles' } }
  }
  const value = params.line === 'k' ? result.k : result.d
  return {
    passed: compareAll(value, params.comparator, params.value),
    values: { k: result.k, d: result.d },
  }
})
