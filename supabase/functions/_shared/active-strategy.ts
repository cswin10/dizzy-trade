// Deno mirror of src/lib/active-strategy.ts.
//
// At scanner time we resolve the single active strategy from
// either the legacy public.strategies table or the composable
// public.strategy_definitions table. When both have an active
// row the composable side wins; we log the inconsistency so the
// operator can correct it.

import type { StrategyDefinition } from './strategies/types.ts'

export type ActiveStrategySource = 'framework' | 'composable'

export type ActiveStrategy = {
  source: ActiveStrategySource
  id: string
  tenant_id: string | null
  name: string
  pairs: string[]
  timeframe: string
  risk_amount_gbp: number | null
  min_rr: number | null
  max_concurrent_positions: number
  max_daily_loss_gbp: number | null
  max_consecutive_losers: number | null
  framework: { id: string; thresholds: Record<string, number> } | null
  definition: StrategyDefinition | null
}

// Loosely typed Supabase client surface so this file can be
// imported by code that has built its own client without forcing
// a specific generic shape on every caller.
type SupabaseLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        value: unknown,
      ) => {
        eq?: (col: string, value: unknown) => unknown
        limit: (
          n: number,
        ) => Promise<{
          data: Record<string, unknown>[] | null
          error: { message: string } | null
        }>
      }
    }
  }
}

// Loads the active strategy for the operator. The legacy
// strategies table has a partial unique index enforcing one
// active row globally (single-tenant deployment), and the new
// strategy_definitions table enforces one active per tenant. For
// v1's single-tenant world we treat both as global.
export async function loadActiveStrategy(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<ActiveStrategy | null> {
  const [legacyRes, composableRes] = await Promise.all([
    supabase
      .from('strategies')
      .select(
        'id, name, framework_id, timeframe, pair_symbols, risk_amount_gbp, min_rr, max_concurrent_positions, max_daily_loss_gbp, max_consecutive_losers',
      )
      .eq('is_active', true)
      .limit(1),
    supabase
      .from('strategy_definitions')
      .select(
        'id, tenant_id, name, definition, pairs, timeframe, max_concurrent_positions, max_daily_loss_gbp, max_consecutive_losers',
      )
      .eq('is_active', true)
      .eq('is_archived', false)
      .limit(1),
  ])

  const legacyRow = legacyRes.data?.[0] ?? null
  const composableRow = composableRes.data?.[0] ?? null

  if (legacyRow && composableRow) {
    console.warn(
      `[active-strategy] BOTH a legacy strategies row (${legacyRow.id}) and ` +
        `a composable strategy_definitions row (${composableRow.id}) are ` +
        'marked active. Preferring composable.',
    )
  }

  if (composableRow) {
    return {
      source: 'composable',
      id: composableRow.id,
      tenant_id: composableRow.tenant_id ?? null,
      name: composableRow.name,
      pairs: composableRow.pairs ?? [],
      timeframe: composableRow.timeframe,
      risk_amount_gbp: null,
      min_rr: null,
      max_concurrent_positions: composableRow.max_concurrent_positions,
      max_daily_loss_gbp:
        composableRow.max_daily_loss_gbp == null
          ? null
          : Number(composableRow.max_daily_loss_gbp),
      max_consecutive_losers: composableRow.max_consecutive_losers,
      framework: null,
      definition: composableRow.definition as StrategyDefinition,
    }
  }

  if (legacyRow) {
    return {
      source: 'framework',
      id: legacyRow.id,
      tenant_id: null,
      name: legacyRow.name,
      pairs: legacyRow.pair_symbols ?? [],
      timeframe: legacyRow.timeframe,
      risk_amount_gbp:
        legacyRow.risk_amount_gbp == null
          ? null
          : Number(legacyRow.risk_amount_gbp),
      min_rr: legacyRow.min_rr == null ? null : Number(legacyRow.min_rr),
      max_concurrent_positions: legacyRow.max_concurrent_positions,
      max_daily_loss_gbp:
        legacyRow.max_daily_loss_gbp == null
          ? null
          : Number(legacyRow.max_daily_loss_gbp),
      max_consecutive_losers: legacyRow.max_consecutive_losers,
      framework: { id: legacyRow.framework_id, thresholds: {} },
      definition: null,
    }
  }

  return null
}
