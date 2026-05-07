import { notFound, redirect } from 'next/navigation'

import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { StrategyBuilder } from '@/components/shared/StrategyBuilder'
import {
  DEFAULT_STRATEGY_CATEGORY,
  isStrategyCategory,
} from '@/lib/strategies/categories'
import type { StrategyDefinition } from '@/lib/strategies/types'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Edit strategy · Dizzy Trade',
}

export default async function EditStrategyPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const [{ data: row, error }, { data: universe }] = await Promise.all([
    supabase
      .from('strategy_definitions')
      .select('*')
      .eq('id', params.id)
      .single(),
    supabase
      .from('universe')
      .select('symbol')
      .eq('is_active', true)
      .order('symbol', { ascending: true }),
  ])
  if (error || !row) notFound()
  const pairUniverse = (universe ?? []).map((u) => u.symbol)

  return (
    <PageContainer>
      <PageHeader
        title={`Edit: ${row.name}`}
        subtitle="Edit any field then save. Saving an active strategy keeps it active; the scanner picks up the new shape on the next tick."
      />
      <StrategyBuilder
        pairUniverse={pairUniverse}
        initial={{
          id: row.id,
          name: row.name,
          description: row.description,
          pairs: row.pairs ?? [],
          timeframe: row.timeframe,
          max_concurrent_positions: row.max_concurrent_positions,
          max_daily_loss_gbp:
            row.max_daily_loss_gbp == null
              ? null
              : Number(row.max_daily_loss_gbp),
          max_consecutive_losers: row.max_consecutive_losers,
          definition: row.definition as unknown as StrategyDefinition,
          category: isStrategyCategory(row.category)
            ? row.category
            : DEFAULT_STRATEGY_CATEGORY,
        }}
      />
    </PageContainer>
  )
}
