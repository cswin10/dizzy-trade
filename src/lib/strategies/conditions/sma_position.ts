import { z } from 'zod'

import { sma } from '@/lib/technical'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

const TYPE = 'sma_position'

export const smaPositionSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    period: z.coerce.number().int().min(2).max(1000),
    position: z.enum(['above', 'below']),
  }),
})

registerConditionSchema(TYPE, smaPositionSchema)

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    period: number
    position: 'above' | 'below'
  }
  const value = sma(
    context.candles.map((c) => c.c),
    params.period,
  )
  if (!Number.isFinite(value)) {
    return { passed: false, values: { reason: 'not enough candles' } }
  }
  const close = context.currentPrice
  const passed = params.position === 'above' ? close > value : close < value
  return { passed, values: { sma: value, close } }
})
