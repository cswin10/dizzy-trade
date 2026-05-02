import { z } from 'zod'

import { atr } from '@/lib/technical'

import { registerTargetEvaluator } from '../evaluator'
import { registerTargetRuleSchema } from '../schema'
import type { TargetRule } from '../types'

const TYPE = 'atr_multiple'

export const atrMultipleTargetSchema: z.ZodType<TargetRule> = z.object({
  type: z.literal(TYPE),
  period: z.coerce.number().int().min(2).max(500),
  multiple: z.coerce.number().positive().max(100),
})

registerTargetRuleSchema(TYPE, atrMultipleTargetSchema)

registerTargetEvaluator(TYPE, (rule, context, direction, entryPrice) => {
  if (rule.type !== TYPE) {
    throw new Error(`atr_multiple target received wrong rule type ${rule.type}`)
  }
  const value = atr(context.candles, rule.period)
  const distance = Number.isFinite(value)
    ? value * rule.multiple
    : entryPrice * 0.02
  return direction === 'long' ? entryPrice + distance : entryPrice - distance
})
