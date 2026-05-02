import { atrSeries } from '../../technical.ts'

import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

import { compareAll } from './_helpers.ts'

const TYPE = 'atr_ratio'

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    period: number
    lookback: number
    comparator: 'lt' | 'lte' | 'gt' | 'gte'
    multiple: number
  }
  const series = atrSeries(context.candles, params.period)
  if (series.length < params.lookback + 1) {
    return { passed: false, values: { reason: 'not enough atr history' } }
  }
  const current = series[series.length - 1]!
  // Average over the trailing window not including the current
  // bar; otherwise a sustained expansion drags its own baseline up
  // and the ratio stays close to 1.
  const recent = series.slice(-params.lookback - 1, -1)
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length
  if (!Number.isFinite(avg) || avg <= 0) {
    return { passed: false, values: { avg } }
  }
  const ratio = current / avg
  return {
    passed: compareAll(ratio, params.comparator, params.multiple),
    values: { current, avg, ratio },
  }
})
