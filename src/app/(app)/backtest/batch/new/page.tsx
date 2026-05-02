import { redirect } from 'next/navigation'

import {
  BatchBacktestForm,
  type BatchStrategyOption,
} from '@/components/shared/BatchBacktestForm'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'New batch backtest · Dizzy Trade',
}

function parseIdList(raw?: string): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export default async function NewBatchBacktestPage({
  searchParams,
}: {
  searchParams: {
    strategy_definition_ids?: string
    legacy_strategy_ids?: string
  }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const [universeRes, composableRes, legacyRes] = await Promise.all([
    supabase
      .from('universe')
      .select('symbol')
      .eq('is_active', true)
      .order('symbol', { ascending: true }),
    supabase
      .from('strategy_definitions')
      .select('id, name, pairs, timeframe, is_archived')
      .eq('is_archived', false)
      .order('updated_at', { ascending: false }),
    supabase
      .from('strategies')
      .select('id, name, pair_symbols, timeframe')
      .order('updated_at', { ascending: false }),
  ])

  const pairUniverse = (universeRes.data ?? []).map((row) => row.symbol)
  const strategies: BatchStrategyOption[] = [
    ...(composableRes.data ?? []).map((row) => ({
      source: 'composable' as const,
      id: row.id,
      name: row.name,
      pairs: row.pairs ?? [],
      timeframe: row.timeframe,
    })),
    ...(legacyRes.data ?? []).map((row) => ({
      source: 'framework' as const,
      id: row.id,
      name: row.name,
      pairs: row.pair_symbols ?? [],
      timeframe: row.timeframe,
    })),
  ]

  return (
    <PageContainer>
      <PageHeader
        title="New batch backtest"
        subtitle="Pick at least two strategies and run them head-to-head against the same period, pairs and fees."
      />
      <BatchBacktestForm
        pairUniverse={pairUniverse}
        strategies={strategies}
        preselectedComposableIds={parseIdList(
          searchParams.strategy_definition_ids,
        )}
        preselectedLegacyIds={parseIdList(searchParams.legacy_strategy_ids)}
      />
    </PageContainer>
  )
}
