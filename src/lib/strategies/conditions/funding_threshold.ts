import { z } from 'zod'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

import { comparatorAllSchema, compareAll } from './_helpers'

const TYPE = 'funding_threshold'

export const fundingThresholdSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    comparator: comparatorAllSchema,
    value: z.coerce.number().min(-1).max(1),
  }),
})

registerConditionSchema(TYPE, fundingThresholdSchema)

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
