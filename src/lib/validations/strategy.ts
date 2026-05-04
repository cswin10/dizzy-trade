// Zod schemas shared between the strategy server actions and the
// settings UI. Mirror the strategies table columns; coerce numeric
// inputs from the form so callers can pass strings or numbers.

import { z } from 'zod'

export const TIMEFRAMES = ['15m', '1h', '4h', '1d'] as const
export type Timeframe = (typeof TIMEFRAMES)[number]

const symbolSchema = z
  .string()
  .trim()
  .min(1, 'Symbol cannot be empty')
  .max(32, 'Symbol too long')
  .regex(/^[A-Z0-9]+$/, 'Symbol must be uppercase letters and digits')

export const strategyInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  framework_id: z.string().trim().min(1, 'Framework is required').max(64),
  timeframe: z.enum(TIMEFRAMES),
  pair_symbols: z
    .array(symbolSchema)
    .min(1, 'At least one pair is required')
    .max(50, 'Too many pairs'),
  risk_amount_gbp: z.coerce
    .number()
    .positive('Risk must be greater than zero')
    .max(100_000),
  min_rr: z.coerce.number().positive().max(20).default(2.0),
  max_concurrent_positions: z.coerce.number().int().min(1).max(50).default(3),
  max_daily_loss_gbp: z.coerce.number().positive().max(1_000_000).nullable(),
  max_consecutive_losers: z.coerce.number().int().min(1).max(100).nullable(),
  // Lifecycle flag for the legacy strategies table. Mirrors the
  // four-state deployment_status enum on the strategy_definitions
  // table introduced in 0026; defaults to 'draft' so newly-created
  // rows do not race with the live scanner.
  deployment_status: z
    .enum(['draft', 'live', 'paused', 'archived'])
    .default('draft'),
})

export type StrategyInput = z.infer<typeof strategyInputSchema>
