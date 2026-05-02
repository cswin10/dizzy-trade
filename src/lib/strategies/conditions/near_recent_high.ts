import { z } from 'zod'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

const TYPE = 'near_recent_high'

export const nearRecentHighSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    lookback: z.coerce.number().int().min(2).max(2000),
    within_pct: z.coerce.number().positive().max(100),
  }),
})

registerConditionSchema(TYPE, nearRecentHighSchema)

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as { lookback: number; within_pct: number }
  if (context.candles.length < params.lookback + 1) {
    return { passed: false, values: { reason: 'not enough candles' } }
  }
  // Excludes the current bar so the close is being compared
  // against prior structure, not against itself.
  const window = context.candles.slice(-params.lookback - 1, -1)
  let highest = -Infinity
  for (const c of window) if (c.h > highest) highest = c.h
  if (!Number.isFinite(highest) || highest <= 0) {
    return { passed: false, values: { highest } }
  }
  const close = context.currentPrice
  const pct = ((highest - close) / highest) * 100
  return {
    passed: pct <= params.within_pct,
    values: { recent_high: highest, distance_pct: pct },
  }
})
