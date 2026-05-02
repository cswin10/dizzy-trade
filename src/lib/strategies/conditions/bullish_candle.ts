import { z } from 'zod'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

const TYPE = 'bullish_candle'

export const bullishCandleSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({}).strict(),
})

registerConditionSchema(TYPE, bullishCandleSchema)

registerConditionEvaluator(TYPE, (_condition, context) => {
  const c = context.currentCandle
  return { passed: c.c > c.o, values: { open: c.o, close: c.c } }
})
