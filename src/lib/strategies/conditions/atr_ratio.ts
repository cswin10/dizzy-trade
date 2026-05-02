import { z } from 'zod'

import { atrSeries } from '@/lib/technical'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

import { comparatorAllSchema, compareAll } from './_helpers'

const TYPE = 'atr_ratio'

export const atrRatioSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    period: z.coerce.number().int().min(2).max(500),
    lookback: z.coerce.number().int().min(2).max(2000),
    comparator: comparatorAllSchema,
    multiple: z.coerce.number().positive().max(1000),
  }),
})

registerConditionSchema(TYPE, atrRatioSchema)

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
