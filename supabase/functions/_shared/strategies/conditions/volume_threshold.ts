import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

import { compareAll } from './_helpers.ts'

const TYPE = 'volume_threshold'

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    comparator: 'lt' | 'lte' | 'gt' | 'gte'
    value: number
  }
  const current = context.currentCandle.v
  return {
    passed: compareAll(current, params.comparator, params.value),
    values: { volume: current },
  }
})
