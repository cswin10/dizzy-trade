import { z } from 'zod'

import { ema } from '@/lib/technical'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

const TYPE = 'ema_position'

export const emaPositionSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    period: z.coerce.number().int().min(2).max(1000),
    position: z.enum(['above', 'below']),
  }),
})

registerConditionSchema(TYPE, emaPositionSchema)

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    period: number
    position: 'above' | 'below'
  }
  const value = ema(
    context.candles.map((c) => c.c),
    params.period,
  )
  if (!Number.isFinite(value)) {
    return { passed: false, values: { reason: 'not enough candles' } }
  }
  const close = context.currentPrice
  const passed = params.position === 'above' ? close > value : close < value
  return { passed, values: { ema: value, close } }
})
