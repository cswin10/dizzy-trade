import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

const TYPE = 'near_recent_low'

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as { lookback: number; within_pct: number }
  if (context.candles.length < params.lookback + 1) {
    return { passed: false, values: { reason: 'not enough candles' } }
  }
  const window = context.candles.slice(-params.lookback - 1, -1)
  let lowest = Infinity
  for (const c of window) if (c.l < lowest) lowest = c.l
  if (!Number.isFinite(lowest) || lowest <= 0) {
    return { passed: false, values: { lowest } }
  }
  const close = context.currentPrice
  const pct = ((close - lowest) / lowest) * 100
  return {
    passed: pct <= params.within_pct,
    values: { recent_low: lowest, distance_pct: pct },
  }
})
