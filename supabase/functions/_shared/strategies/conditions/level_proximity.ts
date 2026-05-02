import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

const TYPE = 'level_proximity'

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as { level: number; within_pct: number }
  const close = context.currentPrice
  const distancePct = (Math.abs(close - params.level) / params.level) * 100
  return {
    passed: distancePct <= params.within_pct,
    values: { level: params.level, close, distance_pct: distancePct },
  }
})
