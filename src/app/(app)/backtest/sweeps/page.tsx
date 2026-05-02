import Link from 'next/link'
import { redirect } from 'next/navigation'

import { BacktestTabs } from '@/components/shared/BacktestTabs'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { SweepsList, type SweepSummary } from '@/components/shared/SweepsList'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Sweeps · Dizzy Trade',
}

export default async function SweepsListPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data, error } = await supabase
    .from('backtest_sweeps')
    .select(
      'id, name, status, framework_id, timeframe, pairs, date_range_start, date_range_end, total_combinations, combinations_completed, combinations_failed, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  const sweeps: SweepSummary[] =
    error || !data
      ? []
      : data.map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          framework_id: row.framework_id,
          timeframe: row.timeframe,
          pairs: row.pairs,
          date_range_start: row.date_range_start,
          date_range_end: row.date_range_end,
          total_combinations: row.total_combinations,
          combinations_completed: row.combinations_completed,
          combinations_failed: row.combinations_failed,
          created_at: row.created_at,
        }))

  return (
    <PageContainer>
      <PageHeader
        title="Backtest"
        subtitle="Replay strategies on historical candle data and compare parameter settings."
        rightSlot={
          <Link href="/backtest/sweeps/new" className="contents">
            <Button className="w-auto">New sweep</Button>
          </Link>
        }
      />
      <BacktestTabs active="sweeps" />
      <div className="mt-4">
        <SweepsList sweeps={sweeps} />
      </div>
    </PageContainer>
  )
}
