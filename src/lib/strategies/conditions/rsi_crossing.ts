import { z } from 'zod'

import { rsi } from '@/lib/technical'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

const TYPE = 'rsi_crossing'

export const rsiCrossingSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    period: z.coerce.number().int().min(2).max(500),
    direction: z.enum(['crossing_below', 'crossing_above']),
    value: z.coerce.number().min(0).max(100),
  }),
})

registerConditionSchema(TYPE, rsiCrossingSchema)

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    period: number
    direction: 'crossing_below' | 'crossing_above'
    value: number
  }
  const closes = context.candles.map((c) => c.c)
  if (closes.length < 2) {
    return { passed: false, values: { reason: 'not enough candles' } }
  }
  const current = rsi(closes, params.period)
  const previous = rsi(closes.slice(0, -1), params.period)
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return { passed: false, values: { current, previous } }
  }
  const crossingBelow = previous >= params.value && current < params.value
  const crossingAbove = previous <= params.value && current > params.value
  const passed =
    params.direction === 'crossing_below' ? crossingBelow : crossingAbove
  return { passed, values: { current, previous } }
})
