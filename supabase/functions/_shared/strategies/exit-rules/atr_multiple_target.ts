import { atr } from '../../technical.ts'

import { registerTargetEvaluator } from '../evaluator.ts'
import type { TargetRule } from '../types.ts'

const TYPE = 'atr_multiple'

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
