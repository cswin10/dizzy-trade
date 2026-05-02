import { z } from 'zod'

import { sma } from '@/lib/technical'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

import { comparatorAllSchema, compareAll } from './_helpers'

const TYPE = 'sma_distance'

export const smaDistanceSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    period: z.coerce.number().int().min(2).max(1000),
    comparator: comparatorAllSchema,
    distance_pct: z.coerce.number().min(0).max(100),
    side: z.enum(['above', 'below', 'absolute']),
  }),
})

registerConditionSchema(TYPE, smaDistanceSchema)

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    period: number
    comparator: 'lt' | 'lte' | 'gt' | 'gte'
    distance_pct: number
    side: 'above' | 'below' | 'absolute'
  }
  const value = sma(
    context.candles.map((c) => c.c),
    params.period,
  )
  if (!Number.isFinite(value) || value <= 0) {
    return { passed: false, values: { reason: 'no sma' } }
  }
  const close = context.currentPrice
  let raw: number
  if (params.side === 'above') raw = close - value
  else if (params.side === 'below') raw = value - close
  else raw = Math.abs(close - value)
  const distancePct = (raw / value) * 100
  return {
    passed: compareAll(distancePct, params.comparator, params.distance_pct),
    values: { sma: value, distance_pct: distancePct },
  }
})
