import { z } from 'zod'

import { williamsR } from '@/lib/technical'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

import { comparatorAllSchema, compareAll } from './_helpers'

const TYPE = 'williams_r_threshold'

export const williamsRThresholdSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    period: z.coerce.number().int().min(2).max(500),
    comparator: comparatorAllSchema,
    value: z.coerce.number().min(-100).max(0),
  }),
})

registerConditionSchema(TYPE, williamsRThresholdSchema)

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    period: number
    comparator: 'lt' | 'lte' | 'gt' | 'gte'
    value: number
  }
  const value = williamsR(context.candles, params.period)
  return {
    passed: compareAll(value, params.comparator, params.value),
    values: { williams_r: value },
  }
})
