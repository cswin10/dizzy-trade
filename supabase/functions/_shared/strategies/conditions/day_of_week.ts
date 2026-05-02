import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

const TYPE = 'day_of_week'

// 0 = Sunday, 6 = Saturday, matching Date.prototype.getUTCDay.

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as { days: number[] }
  const day = new Date(context.currentCandle.t).getUTCDay()
  return { passed: params.days.includes(day), values: { day_utc: day } }
})
