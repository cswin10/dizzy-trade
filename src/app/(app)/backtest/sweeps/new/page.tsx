import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import {
  SweepConfigForm,
  type SweepComposableStrategyOption,
} from '@/components/shared/SweepConfigForm'
import type { StrategyDefinition } from '@/lib/strategies/types'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'New sweep · Dizzy Trade',
}

export default async function NewSweepPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const [universeRes, legacyRes, composableRes] = await Promise.all([
    supabase
      .from('universe')
      .select('symbol')
      .eq('is_active', true)
      .order('symbol', { ascending: true }),
    supabase
      .from('strategies')
      .select('framework_id, timeframe, pair_symbols')
      .eq('deployment_status', 'live')
      .limit(1),
    supabase
      .from('strategy_definitions')
      .select(
        'id, name, definition, pairs, timeframe, max_concurrent_positions, max_daily_loss_gbp, max_consecutive_losers',
      )
      .eq('is_archived', false)
      .order('updated_at', { ascending: false }),
  ])

  const pairUniverse = (universeRes.data ?? []).map((row) => row.symbol)
  const activeStrategy = legacyRes.data?.[0]
  const composableStrategies: SweepComposableStrategyOption[] = (
    composableRes.data ?? []
  ).map((row) => ({
    id: row.id,
    name: row.name,
    pairs: row.pairs ?? [],
    timeframe: row.timeframe,
    max_concurrent_positions: row.max_concurrent_positions,
    max_daily_loss_gbp:
      row.max_daily_loss_gbp == null ? null : Number(row.max_daily_loss_gbp),
    max_consecutive_losers: row.max_consecutive_losers,
    definition: row.definition as unknown as StrategyDefinition,
  }))

  return (
    <PageContainer>
      <PageHeader
        title="New parameter sweep"
        subtitle="Vary thresholds and risk parameters across a range of values, run all combinations, and compare results."
      />
      <SweepConfigForm
        pairUniverse={pairUniverse}
        defaultPairs={activeStrategy?.pair_symbols}
        defaultFrameworkId={activeStrategy?.framework_id}
        defaultTimeframe={activeStrategy?.timeframe}
        composableStrategies={composableStrategies}
      />
    </PageContainer>
  )
}
