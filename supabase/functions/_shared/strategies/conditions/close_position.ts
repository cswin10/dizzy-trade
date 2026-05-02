import { candleClosePosition } from '../../technical.ts'

import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

const TYPE = 'close_position'

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    position: 'upper_third' | 'lower_third' | 'upper_half' | 'lower_half'
  }
  const pos = candleClosePosition(context.currentCandle)
  let passed = false
  switch (params.position) {
    case 'upper_third':
      passed = pos >= 2 / 3
      break
    case 'lower_third':
      passed = pos <= 1 / 3
      break
    case 'upper_half':
      passed = pos >= 0.5
      break
    case 'lower_half':
      passed = pos <= 0.5
      break
  }
  return { passed, values: { close_position: pos } }
})
