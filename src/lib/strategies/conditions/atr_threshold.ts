import { z } from 'zod'

import { atr } from '@/lib/technical'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

import { comparatorAllSchema, compareAll } from './_helpers'

const TYPE = 'atr_threshold'

export const atrThresholdSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    period: z.coerce.number().int().min(2).max(500),
    comparator: comparatorAllSchema,
    value: z.coerce.number().min(0),
  }),
})

registerConditionSchema(TYPE, atrThresholdSchema)

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
