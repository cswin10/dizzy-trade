// Unified active-strategy resolver.
//
// Until 20a/b/c the live system had a single source of strategies:
// the legacy public.strategies table, where each row binds a
// hardcoded framework_id to a pair list and risk knobs. The
// composable system added a second source: public.strategy_definitions,
// where the strategy is a JSON document evaluated by a registry-
// driven engine.
//
// At any moment exactly one of those rows should be active per
// tenant. Cross-table mutual exclusion is enforced by the
// activation server actions; this helper assumes the invariant
// holds and falls back to a clear warning if it does not.
//
// Both the scanner (Deno) and various Node call sites need to
// know the currently-active strategy without caring which table
// it lives in. The unified ActiveStrategy type below collapses
// the two row shapes into one consumer-facing surface.

import type { SupabaseClient } from '@supabase/supabase-js'

import type { StrategyDefinition } from '@/lib/strategies/types'
import type { Database } from '@/types/database'

export type ActiveStrategySource = 'framework' | 'composable'

export type ActiveStrategy = {
  source: ActiveStrategySource
  id: string
  name: string
  pairs: string[]
  timeframe: string
  risk_amount_gbp: number | null
  min_rr: number | null
  max_concurrent_positions: number
  max_daily_loss_gbp: number | null
  max_consecutive_losers: number | null
  // Source-specific payload. Exactly one is non-null.
  framework: { id: string; thresholds: Record<string, number> } | null
  definition: StrategyDefinition | null
}

// Resolves the active strategy for a tenant. Returns null when
// neither table has an active row. When both are active (operator
// error or a mid-flight migration), prefers the composable side
// and logs a warning so the misconfiguration surfaces in logs.
export async function loadActiveStrategy(
  supabase: SupabaseClient<Database>,
  tenantId: string,
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
        'id, name, definition, pairs, timeframe, max_concurrent_positions, max_daily_loss_gbp, max_consecutive_losers',
      )
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .eq('is_archived', false)
      .limit(1),
  ])

  const legacyRow = legacyRes.data?.[0] ?? null
  const composableRow = composableRes.data?.[0] ?? null

  if (legacyRow && composableRow) {
    console.warn(
      `[active-strategy] tenant=${tenantId} has BOTH a legacy strategies row ` +
        `(${legacyRow.id}) and a composable strategy_definitions row ` +
        `(${composableRow.id}) marked active. Preferring composable. ` +
        'Run the activation action again to clear this state.',
    )
  }

  if (composableRow) {
    // Pull threshold lookups for the composable strategy: none.
    // The definition itself carries everything the evaluator needs.
    return {
      source: 'composable',
      id: composableRow.id,
      name: composableRow.name,
      pairs: composableRow.pairs,
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
      definition: composableRow.definition as unknown as StrategyDefinition,
    }
  }

  if (legacyRow) {
    // Threshold lookup happens inside the scanner; we surface only
    // the framework_id here and let the caller fetch thresholds
    // from framework_thresholds when needed.
    return {
      source: 'framework',
      id: legacyRow.id,
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
