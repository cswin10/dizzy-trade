import { z } from 'zod'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

const TYPE = 'level_proximity'

export const levelProximitySchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    level: z.coerce.number().positive(),
    within_pct: z.coerce.number().positive().max(100),
  }),
})

registerConditionSchema(TYPE, levelProximitySchema)

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as { level: number; within_pct: number }
  const close = context.currentPrice
  const distancePct = (Math.abs(close - params.level) / params.level) * 100
  return {
    passed: distancePct <= params.within_pct,
    values: { level: params.level, close, distance_pct: distancePct },
  }
})
