import { z } from 'zod'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

const TYPE = 'day_of_week'

// 0 = Sunday, 6 = Saturday, matching Date.prototype.getUTCDay.
export const dayOfWeekSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    days: z.array(z.coerce.number().int().min(0).max(6)).min(1),
  }),
})

registerConditionSchema(TYPE, dayOfWeekSchema)

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as { days: number[] }
  const day = new Date(context.currentCandle.t).getUTCDay()
  return { passed: params.days.includes(day), values: { day_utc: day } }
})
