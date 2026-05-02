import { z } from 'zod'

import { candleClosePosition } from '@/lib/technical'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

const TYPE = 'close_position'

export const closePositionSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    position: z.enum([
      'upper_third',
      'lower_third',
      'upper_half',
      'lower_half',
    ]),
  }),
})

registerConditionSchema(TYPE, closePositionSchema)

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    position: 'upper_third' | 'lower_third' | 'upper_half' | 'lower_half'
  }
  const pos = candleClosePosition(context.currentCandle)
  let passed = false
  switch (params.position) {
    case 'upper_third':
      passed = pos >= 2 / 3
      break
    case 'lower_third':
      passed = pos <= 1 / 3
      break
    case 'upper_half':
      passed = pos >= 0.5
      break
    case 'lower_half':
      passed = pos <= 0.5
      break
  }
  return { passed, values: { close_position: pos } }
})
