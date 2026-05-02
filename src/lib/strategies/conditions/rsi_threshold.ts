import { z } from 'zod'

import { rsi } from '@/lib/technical'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

import { comparatorAllSchema, compareAll } from './_helpers'

const TYPE = 'rsi_threshold'

export const rsiThresholdSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    period: z.coerce.number().int().min(2).max(500),
    comparator: comparatorAllSchema,
    value: z.coerce.number().min(0).max(100),
  }),
})

registerConditionSchema(TYPE, rsiThresholdSchema)

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
