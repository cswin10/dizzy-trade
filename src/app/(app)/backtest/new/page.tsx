import { redirect } from 'next/navigation'

import {
  BacktestConfigForm,
  type ComposableStrategyOption,
} from '@/components/shared/BacktestConfigForm'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'New backtest · Dizzy Trade',
}

export default async function NewBacktestPage({
  searchParams,
}: {
  searchParams: { strategy_definition_id?: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  // Pre-fill the form from the live universe, the active legacy
  // strategy (if any), and the user's composable strategies. The
  // strategy lookups are best-effort; the form survives any of
  // them missing.
  const [universeRes, legacyStrategyRes, composableStrategiesRes] =
    await Promise.all([
      supabase
        .from('universe')
        .select('symbol')
        .eq('is_active', true)
        .order('symbol', { ascending: true }),
      supabase
        .from('strategies')
        .select(
          'framework_id, timeframe, pair_symbols, risk_amount_gbp, min_rr, max_concurrent_positions',
        )
        .eq('deployment_status', 'live')
        .limit(1),
      supabase
        .from('strategy_definitions')
        .select(
          'id, name, pairs, timeframe, max_concurrent_positions, max_daily_loss_gbp, max_consecutive_losers',
        )
        .eq('is_archived', false)
        .order('updated_at', { ascending: false }),
    ])

  const pairUniverse = (universeRes.data ?? []).map((row) => row.symbol)
  const activeStrategy = legacyStrategyRes.data?.[0]
  const composableStrategies: ComposableStrategyOption[] = (
    composableStrategiesRes.data ?? []
  ).map((row) => ({
    id: row.id,
    name: row.name,
    pairs: row.pairs ?? [],
    timeframe: row.timeframe,
    max_concurrent_positions: row.max_concurrent_positions,
    max_daily_loss_gbp:
      row.max_daily_loss_gbp == null ? null : Number(row.max_daily_loss_gbp),
    max_consecutive_losers: row.max_consecutive_losers,
  }))

  return (
    <PageContainer>
      <PageHeader
        title="New backtest"
        subtitle="Configure the strategy, risk parameters, and date range, then run."
      />
      <BacktestConfigForm
        pairUniverse={pairUniverse}
        defaultPairs={activeStrategy?.pair_symbols}
        defaultFrameworkId={activeStrategy?.framework_id}
        defaultTimeframe={activeStrategy?.timeframe}
        defaultRiskAmountGbp={
          activeStrategy?.risk_amount_gbp != null
            ? Number(activeStrategy.risk_amount_gbp)
            : undefined
        }
        defaultMinRr={
          activeStrategy?.min_rr != null
            ? Number(activeStrategy.min_rr)
            : undefined
        }
        defaultMaxConcurrent={activeStrategy?.max_concurrent_positions}
        composableStrategies={composableStrategies}
        defaultStrategyDefinitionId={searchParams.strategy_definition_id}
      />
    </PageContainer>
  )
}
