import { z } from 'zod'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

const TYPE = 'hour_of_day'

export const hourOfDaySchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    hours: z.array(z.coerce.number().int().min(0).max(23)).min(1),
  }),
})

registerConditionSchema(TYPE, hourOfDaySchema)

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as { hours: number[] }
  const hour = new Date(context.currentCandle.t).getUTCHours()
  return {
    passed: params.hours.includes(hour),
    values: { hour_utc: hour },
  }
})
