import { z } from 'zod'

import { registerStopEvaluator } from '../evaluator'
import { registerStopRuleSchema } from '../schema'
import type { StopRule } from '../types'

const TYPE = 'recent_swing'
const DEFAULT_BUFFER_PCT = 0.2

export const recentSwingStopSchema: z.ZodType<StopRule> = z.object({
  type: z.literal(TYPE),
  lookback_candles: z.coerce.number().int().min(2).max(2000),
  buffer_pct: z.coerce.number().min(0).max(20).optional(),
})

registerStopRuleSchema(TYPE, recentSwingStopSchema)

registerStopEvaluator(TYPE, (rule, context, direction, entryPrice) => {
  if (rule.type !== TYPE) {
    throw new Error(`recent_swing stop received wrong rule type ${rule.type}`)
  }
  const buffer = (rule.buffer_pct ?? DEFAULT_BUFFER_PCT) / 100
  const window = context.candles.slice(-rule.lookback_candles)
  if (window.length === 0) {
    return direction === 'long' ? entryPrice * 0.99 : entryPrice * 1.01
  }
  if (direction === 'long') {
    let lowest = Infinity
    for (const c of window) if (c.l < lowest) lowest = c.l
    if (!Number.isFinite(lowest) || lowest <= 0) return entryPrice * 0.99
    return lowest * (1 - buffer)
  }
  let highest = -Infinity
  for (const c of window) if (c.h > highest) highest = c.h
  if (!Number.isFinite(highest)) return entryPrice * 1.01
  return highest * (1 + buffer)
})
