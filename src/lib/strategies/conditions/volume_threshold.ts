import { z } from 'zod'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

import { comparatorAllSchema, compareAll } from './_helpers'

const TYPE = 'volume_threshold'

export const volumeThresholdSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    comparator: comparatorAllSchema,
    value: z.coerce.number().min(0),
  }),
})

registerConditionSchema(TYPE, volumeThresholdSchema)

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
