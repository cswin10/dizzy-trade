import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

const TYPE = 'bullish_candle'

registerConditionEvaluator(TYPE, (_condition, context) => {
  const c = context.currentCandle
  return { passed: c.c > c.o, values: { open: c.o, close: c.c } }
})
