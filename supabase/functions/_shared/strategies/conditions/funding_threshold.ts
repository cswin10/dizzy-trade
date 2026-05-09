import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

import { compareAll } from './_helpers.ts'

const TYPE = 'funding_threshold'

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    comparator: 'lt' | 'lte' | 'gt' | 'gte'
    value: number
  }
  // The live scanner always populates context.funding from the
  // bulk market-data response. Only path that can land here with
  // funding undefined is a market-data fetch failure: surface it
  // explicitly so the alert UI shows missing_data rather than a
  // false negative.
  if (context.funding === undefined || context.funding === null) {
    return {
      passed: false,
      values: {
        value: null,
        missing_data: true,
        reason: 'no funding data',
      },
    }
  }
  return {
    passed: compareAll(context.funding, params.comparator, params.value),
    values: { funding: context.funding },
  }
})
