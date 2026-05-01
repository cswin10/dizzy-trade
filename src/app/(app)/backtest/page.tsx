import Link from 'next/link'
import { redirect } from 'next/navigation'

import {
  BacktestRunsList,
  type BacktestRunSummary,
} from '@/components/shared/BacktestRunsList'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Backtest · Dizzy Trade',
}

export default async function BacktestListPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data, error } = await supabase
    .from('backtest_runs')
    .select(
      'id, name, status, framework_id, timeframe, pairs, date_range_start, date_range_end, created_at, total_trades, win_rate, total_pnl_gbp, avg_r, overfit_warning_triggered',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  const runs: BacktestRunSummary[] =
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
          created_at: row.created_at,
          total_trades: row.total_trades,
          win_rate: row.win_rate == null ? null : Number(row.win_rate),
          total_pnl_gbp:
            row.total_pnl_gbp == null ? null : Number(row.total_pnl_gbp),
          avg_r: row.avg_r == null ? null : Number(row.avg_r),
          overfit_warning_triggered: row.overfit_warning_triggered,
        }))

  return (
    <PageContainer>
      <PageHeader
        title="Backtest"
        subtitle="Replay strategies on historical candle data and review trade-by-trade performance."
        rightSlot={
          <Link href="/backtest/new" className="contents">
            <Button className="w-auto">New backtest</Button>
          </Link>
        }
      />
      <BacktestRunsList runs={runs} />
    </PageContainer>
  )
}
