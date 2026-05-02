import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

const TYPE = 'hour_of_day'

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as { hours: number[] }
  const hour = new Date(context.currentCandle.t).getUTCHours()
  return {
    passed: params.hours.includes(hour),
    values: { hour_utc: hour },
  }
})
