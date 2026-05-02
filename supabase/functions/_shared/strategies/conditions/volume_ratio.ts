import { sma } from '../../technical.ts'

import { registerConditionEvaluator } from '../evaluator.ts'
import type { Condition } from '../types.ts'

import { compareAll } from './_helpers.ts'

const TYPE = 'volume_ratio'

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    period: number
    comparator: 'lt' | 'lte' | 'gt' | 'gte'
    multiple: number
  }
  const volumes = context.candles.map((c) => c.v)
  if (volumes.length < params.period + 1) {
    return { passed: false, values: { reason: 'not enough candles' } }
  }
  // Average over the candles preceding the current bar so the
  // ratio reflects how unusual this bar's volume is. Including the
  // current bar in its own average makes the threshold harder to
  // breach during a real spike.
  const priorVolumes = volumes.slice(-params.period - 1, -1)
  const avg = sma(priorVolumes, params.period)
  if (!Number.isFinite(avg) || avg <= 0) {
    return { passed: false, values: { avg } }
  }
  const current = volumes[volumes.length - 1]!
  const ratio = current / avg
  return {
    passed: compareAll(ratio, params.comparator, params.multiple),
    values: { current, avg, ratio },
  }
})
