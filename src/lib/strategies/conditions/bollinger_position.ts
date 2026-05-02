import { z } from 'zod'

import { bollinger } from '@/lib/technical'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

const TYPE = 'bollinger_position'

const TOUCH_TOLERANCE = 0.001 // 0.1%

export const bollingerPositionSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    period: z.coerce.number().int().min(2).max(500),
    std_dev: z.coerce.number().positive().max(10),
    position: z.enum([
      'above_upper',
      'below_lower',
      'inside',
      'touching_upper',
      'touching_lower',
    ]),
  }),
})

registerConditionSchema(TYPE, bollingerPositionSchema)

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    period: number
    std_dev: number
    position:
      | 'above_upper'
      | 'below_lower'
      | 'inside'
      | 'touching_upper'
      | 'touching_lower'
  }
  const bands = bollinger(
    context.candles.map((c) => c.c),
    params.period,
    params.std_dev,
  )
  if (!bands) {
    return { passed: false, values: { reason: 'not enough candles' } }
  }
  const close = context.currentPrice
  const distUpper = Math.abs(close - bands.upper) / bands.upper
  const distLower = Math.abs(close - bands.lower) / Math.max(bands.lower, 1e-9)
  let passed = false
  switch (params.position) {
    case 'above_upper':
      passed = close > bands.upper
      break
    case 'below_lower':
      passed = close < bands.lower
      break
    case 'inside':
      passed = close >= bands.lower && close <= bands.upper
      break
    case 'touching_upper':
      passed = distUpper <= TOUCH_TOLERANCE
      break
    case 'touching_lower':
      passed = distLower <= TOUCH_TOLERANCE
      break
  }
  return {
    passed,
    values: {
      upper: bands.upper,
      middle: bands.middle,
      lower: bands.lower,
      close,
    },
  }
})
