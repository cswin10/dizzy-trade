import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

const TYPE = 'near_recent_high'

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
