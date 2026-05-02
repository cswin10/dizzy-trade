import { z } from 'zod'

import { BACKTEST_TIMEFRAMES } from '@/lib/backtest/types'

const symbolSchema = z
  .string()
  .trim()
  .min(1, 'Symbol cannot be empty')
  .max(32, 'Symbol too long')
  .regex(/^[A-Z0-9]+$/, 'Symbol must be uppercase letters and digits')

// Composable sweeps may write the target field as `path` (JSON
// path into a strategy_definition snapshot) instead of `key`
// (flat framework field). We coerce path into key in a preprocess
// step so the discriminated union below sees a single field name
// regardless of which the wire format used.
const normaliseDimensionTarget = (raw: unknown): unknown => {
  if (typeof raw !== 'object' || raw === null) return raw
  const obj = raw as Record<string, unknown>
  if (
    obj.key === undefined &&
    typeof obj.path === 'string' &&
    obj.path.length > 0
  ) {
    return { ...obj, key: obj.path }
  }
  return obj
}

export const sweepDimensionSchema = z.preprocess(
  normaliseDimensionTarget,
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('range'),
      key: z.string().trim().min(1).max(256),
      start: z.coerce.number().finite(),
      end: z.coerce.number().finite(),
      step: z.coerce.number().positive(),
    }),
    z.object({
      type: z.literal('enum'),
      key: z.string().trim().min(1).max(256),
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
      key: z.string().trim().min(1).max(256),
    }),
  ]),
)

export const sweepConfigInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(160),
    // Either path: framework_id (legacy) or strategy_definition_id
    // (composable). Validated mutually-exclusive in the refine below.
    framework_id: z.string().trim().min(1).max(64).optional(),
    framework_thresholds: z
      .record(z.string(), z.coerce.number().finite())
      .optional(),
    strategy_definition_id: z.string().uuid().optional(),
    timeframe: z.enum(BACKTEST_TIMEFRAMES),
    pairs: z
      .array(symbolSchema)
      .min(1, 'At least one pair is required')
      .max(50),
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
  .superRefine((v, ctx) => {
    const hasFw = Boolean(v.framework_id)
    const hasDef = Boolean(v.strategy_definition_id)
    if (hasFw === hasDef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'sweep needs exactly one of framework_id or strategy_definition_id',
        path: ['framework_id'],
      })
    }
    if (hasFw && !v.framework_thresholds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'framework_thresholds required when targeting a framework',
        path: ['framework_thresholds'],
      })
    }
  })

export type SweepConfigInput = z.infer<typeof sweepConfigInputSchema>
