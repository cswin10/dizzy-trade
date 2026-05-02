import { z } from 'zod'

import { BACKTEST_TIMEFRAMES } from '@/lib/backtest/types'

const symbolSchema = z
  .string()
  .trim()
  .min(1, 'Symbol cannot be empty')
  .max(32, 'Symbol too long')
  .regex(/^[A-Z0-9]+$/, 'Symbol must be uppercase letters and digits')

export const sweepDimensionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('range'),
    key: z.string().trim().min(1).max(64),
    start: z.coerce.number().finite(),
    end: z.coerce.number().finite(),
    step: z.coerce.number().positive(),
  }),
  z.object({
    type: z.literal('enum'),
    key: z.string().trim().min(1).max(64),
    values: z
      .array(
        z.union([
          z.coerce.number().finite(),
          z.string().min(1).max(64),
          z.boolean(),
        ]),
      )
      .min(1, 'Enum dimension needs at least one value'),
  }),
  z.object({
    type: z.literal('boolean'),
    key: z.string().trim().min(1).max(64),
  }),
])

export const sweepConfigInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  framework_id: z.string().trim().min(1).max(64),
  framework_thresholds: z.record(z.string(), z.coerce.number().finite()),
  timeframe: z.enum(BACKTEST_TIMEFRAMES),
  pairs: z.array(symbolSchema).min(1, 'At least one pair is required').max(50),
  date_range_start: z.coerce.date(),
  date_range_end: z.coerce.date(),
  risk_amount_gbp: z.coerce.number().positive().max(100_000),
  min_rr: z.coerce.number().positive().max(20),
  max_concurrent_positions: z.coerce.number().int().min(1).max(50),
  max_daily_loss_gbp: z.coerce.number().positive().max(1_000_000).nullable(),
  max_consecutive_losers: z.coerce.number().int().min(1).max(100).nullable(),
  slippage_pct: z.coerce.number().min(0).max(10),
  maker_fee_pct: z.coerce.number().min(0).max(10),
  taker_fee_pct: z.coerce.number().min(0).max(10),
  assume_taker: z.boolean(),
  enable_train_test_split: z.boolean(),
  train_split_pct: z.coerce.number().min(50).max(90),
  dimensions: z
    .array(sweepDimensionSchema)
    .min(1, 'Add at least one sweep dimension'),
})

export type SweepConfigInput = z.infer<typeof sweepConfigInputSchema>
