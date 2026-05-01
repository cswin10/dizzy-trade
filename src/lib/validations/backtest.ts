// Zod schemas for the backtest configuration form. Mirrors the
// runtime shape consumed by the engine, with friendly defaults so a
// freshly-loaded form can submit without filling everything in.

import { z } from 'zod'

import { BACKTEST_TIMEFRAMES } from '@/lib/backtest/types'

const symbolSchema = z
  .string()
  .trim()
  .min(1, 'Symbol cannot be empty')
  .max(32, 'Symbol too long')
  .regex(/^[A-Z0-9]+$/, 'Symbol must be uppercase letters and digits')

export const backtestConfigInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(160),
    framework_id: z.string().trim().min(1, 'Framework is required').max(64),
    framework_thresholds: z.record(z.string(), z.coerce.number().finite()),
    timeframe: z.enum(BACKTEST_TIMEFRAMES),
    pairs: z
      .array(symbolSchema)
      .min(1, 'At least one pair is required')
      .max(50, 'Too many pairs'),
    risk_amount_gbp: z.coerce
      .number()
      .positive('Risk must be greater than zero')
      .max(100_000),
    min_rr: z.coerce.number().positive().max(20).default(2),
    max_concurrent_positions: z.coerce.number().int().min(1).max(50).default(3),
    max_daily_loss_gbp: z.coerce
      .number()
      .positive()
      .max(1_000_000)
      .nullable()
      .default(100),
    max_consecutive_losers: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .nullable()
      .default(5),
    date_range_start: z.coerce.date(),
    date_range_end: z.coerce.date(),
    slippage_pct: z.coerce.number().min(0).max(10).default(0.05),
    maker_fee_pct: z.coerce.number().min(0).max(10).default(0.015),
    taker_fee_pct: z.coerce.number().min(0).max(10).default(0.045),
    assume_taker: z.boolean().default(true),
    enable_train_test_split: z.boolean().default(true),
    train_split_pct: z.coerce.number().min(50).max(90).default(70),
  })
  .refine((data) => data.date_range_end > data.date_range_start, {
    path: ['date_range_end'],
    message: 'End date must be after start date',
  })

export type BacktestConfigInput = z.infer<typeof backtestConfigInputSchema>
