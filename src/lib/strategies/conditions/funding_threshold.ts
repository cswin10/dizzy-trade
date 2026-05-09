import { z } from 'zod'

import { registerConditionEvaluator } from '../evaluator'
import { registerConditionSchema } from '../schema'
import type { Condition } from '../types'

import { comparatorAllSchema, compareAll } from './_helpers'

const TYPE = 'funding_threshold'

export const fundingThresholdSchema: z.ZodType<Condition> = z.object({
  type: z.literal(TYPE),
  params: z.object({
    comparator: comparatorAllSchema,
    value: z.coerce.number().min(-1).max(1),
  }),
})

registerConditionSchema(TYPE, fundingThresholdSchema)

// Debug log throttle. The condition runs once per candle per pair
// per active strategy, so a 1y/1h backtest with 3 pairs would emit
// ~26k log lines if every missing-data hit logged. Sampling keeps
// the signal that data is missing while keeping the log volume sane.
const MISSING_LOG_SAMPLE = 500
let missingHits = 0

registerConditionEvaluator(TYPE, (condition, context) => {
  const params = condition.params as {
    comparator: 'lt' | 'lte' | 'gt' | 'gte'
    value: number
  }
  // In backtest mode the engine hydrates context.funding from the
  // funding_rates table for the candle's timestamp; if no rate was
  // found within the lookup window the field is undefined here.
  // In live mode the scanner sets it from the live market context,
  // so it is always defined unless market data fetch failed.
  // Either way, undefined -> emit insufficient_data so the
  // evaluator's diagnostics can attribute the failure correctly.
  if (context.funding === undefined || context.funding === null) {
    missingHits++
    if (missingHits === 1 || missingHits % MISSING_LOG_SAMPLE === 0) {
      console.debug(
        `[funding_threshold] no funding rate within lookup window (hit ${missingHits})`,
      )
    }
    return {
      passed: false,
      values: {
        value: null,
        missing_data: true,
        reason: 'no funding data',
      },
    }
  }
  return {
    passed: compareAll(context.funding, params.comparator, params.value),
    values: { funding: context.funding },
  }
})
