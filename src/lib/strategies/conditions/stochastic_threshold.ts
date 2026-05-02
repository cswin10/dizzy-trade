import { z } from 'zod'

import { stochastic } from '@/lib/technical'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

import { comparatorAllSchema, compareAll } from './_helpers'

const TYPE = 'stochastic_threshold'

export const stochasticThresholdSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    k_period: z.coerce.number().int().min(1).max(500),
    d_period: z.coerce.number().int().min(1).max(500),
    smooth: z.coerce.number().int().min(1).max(50),
    line: z.enum(['k', 'd']),
    comparator: comparatorAllSchema,
    value: z.coerce.number().min(0).max(100),
  }),
})

registerConditionSchema(TYPE, stochasticThresholdSchema)

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
