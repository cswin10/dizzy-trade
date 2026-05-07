import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import {
  WalkForwardForm,
  type WalkForwardStrategyOption,
} from '@/components/shared/WalkForwardForm'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'New walk-forward backtest · Dizzy Trade',
}

export default async function NewWalkForwardPage({
  searchParams,
}: {
  searchParams: { strategy_definition_id?: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const [universeRes, strategiesRes] = await Promise.all([
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
  ])

  const pairUniverse = (universeRes.data ?? []).map((row) => row.symbol)
  const strategies: WalkForwardStrategyOption[] = (
    strategiesRes.data ?? []
  ).map((row) => ({
    id: row.id,
    name: row.name,
    pairs: row.pairs ?? [],
    timeframe: row.timeframe,
  }))

  return (
    <PageContainer>
      <PageHeader
        title="New walk-forward backtest"
        subtitle="Run the same strategy across rolling windows to check whether edge persists across the full date range or only printed money in one outlier window."
      />
      <WalkForwardForm
        pairUniverse={pairUniverse}
        strategies={strategies}
        preselectedStrategyId={searchParams.strategy_definition_id}
      />
    </PageContainer>
  )
}
