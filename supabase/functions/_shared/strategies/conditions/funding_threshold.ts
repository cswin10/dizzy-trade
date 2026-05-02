import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

import { compareAll } from './_helpers.ts'

const TYPE = 'funding_threshold'

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    comparator: 'lt' | 'lte' | 'gt' | 'gte'
    value: number
  }
  // Backtest data does not include historical funding for now, so
  // any strategy that depends on this condition simply will not
  // trigger in backtest mode. Surface that explicitly so the
  // operator can spot it in the conditions_at_signal jsonb.
  if (context.funding === undefined || context.funding === null) {
    return {
      passed: false,
      values: { value: null, missing_data: true },
    }
  }
  return {
    passed: compareAll(context.funding, params.comparator, params.value),
    values: { funding: context.funding },
  }
})
