import { atr } from '../../technical.ts'

import { registerStopEvaluator } from '../evaluator.ts'
import type { StopRule } from '../types.ts'

const TYPE = 'atr_multiple'

registerStopEvaluator(TYPE, (rule, context, direction, entryPrice) => {
  if (rule.type !== TYPE) {
    throw new Error(`atr_multiple stop received wrong rule type ${rule.type}`)
  }
  const value = atr(context.candles, rule.period)
  // Falling back to a 1% stop when ATR cannot be computed (not
  // enough history) keeps the engine from throwing mid-evaluation.
  // The caller can detect the fallback if needed by recomputing.
  const distance = Number.isFinite(value)
    ? value * rule.multiple
    : entryPrice * 0.01
  return direction === 'long' ? entryPrice - distance : entryPrice + distance
})
