// Fixed category enum for strategy_definitions. Mirrored exactly by
// the CHECK constraint in supabase/migrations/0032_strategy_categories.sql;
// editing this list requires a follow-up migration.

export const STRATEGY_CATEGORIES = [
  'Momentum',
  'Mean Reversion',
  'Volatility',
  'Breakout',
  'Time-based',
  'Funding',
  'Other',
] as const

export type StrategyCategory = (typeof STRATEGY_CATEGORIES)[number]

export const DEFAULT_STRATEGY_CATEGORY: StrategyCategory = 'Other'

export function isStrategyCategory(value: unknown): value is StrategyCategory {
  return (
    typeof value === 'string' &&
    (STRATEGY_CATEGORIES as readonly string[]).includes(value)
  )
}
