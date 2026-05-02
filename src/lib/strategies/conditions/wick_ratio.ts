import { z } from 'zod'

import { candleBody, candleLowerWick, candleUpperWick } from '@/lib/technical'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

import { comparatorAllSchema, compareAll } from './_helpers'

const TYPE = 'wick_ratio'

export const wickRatioSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    side: z.enum(['upper', 'lower']),
    comparator: comparatorAllSchema,
    multiple: z.coerce.number().positive().max(1000),
  }),
})

registerConditionSchema(TYPE, wickRatioSchema)

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    side: 'upper' | 'lower'
    comparator: 'lt' | 'lte' | 'gt' | 'gte'
    multiple: number
  }
  const c = context.currentCandle
  const body = candleBody(c)
  const wick = params.side === 'upper' ? candleUpperWick(c) : candleLowerWick(c)
  // Guard against zero-body doji bars: treat the body as a tiny
  // floor so the ratio stays finite. Anything past the multiple
  // still passes; bars with neither body nor wick still won't.
  const effectiveBody = Math.max(body, Math.abs(c.c) * 1e-6, 1e-9)
  const ratio = wick / effectiveBody
  return {
    passed: compareAll(ratio, params.comparator, params.multiple),
    values: { ratio, body, wick },
  }
})
