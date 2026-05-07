import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { WalkForwardDetail } from '@/components/shared/WalkForwardDetail'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { StrategyWorkspaceTabs } from '@/components/shared/StrategyWorkspaceTabs'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const metadata = { title: 'Walk-forward · Dizzy Trade' }

export default async function WalkForwardDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const service = createServiceClient()
  const { data: parent } = await service
    .from('walk_forward_runs')
    .select('*')
    .eq('id', params.id)
    .single()
  if (!parent) notFound()

  const { data: children } = await service
    .from('backtest_runs')
    .select(
      'id, name, status, total_trades, win_rate, avg_r, total_pnl_gbp, max_drawdown_gbp, sharpe_ratio, date_range_start, date_range_end',
    )
    .in('id', parent.child_run_ids ?? [])

  // Children may come back in any order; the parent's
  // child_run_ids array carries the chronological order so we
  // sort by it.
  const order = new Map<string, number>()
  ;(parent.child_run_ids ?? []).forEach((id: string, i: number) =>
    order.set(id, i),
  )
  const orderedChildren = (children ?? [])
    .slice()
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))

  return (
    <PageContainer>
      <PageHeader
        title="Walk-forward run"
        subtitle={`${parent.window_size_days}-day window stepping ${parent.step_size_days} days`}
        rightSlot={
          <Link href="/backtest" className="contents">
            <Button variant="ghost" className="w-auto">
              Back to backtest
            </Button>
          </Link>
        }
      />
      <StrategyWorkspaceTabs active="backtest" />
      <WalkForwardDetail
        parent={parent}
        childRows={orderedChildren.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          total_trades: r.total_trades,
          win_rate: r.win_rate == null ? null : Number(r.win_rate),
          avg_r: r.avg_r == null ? null : Number(r.avg_r),
          total_pnl_gbp:
            r.total_pnl_gbp == null ? null : Number(r.total_pnl_gbp),
          max_drawdown_gbp:
            r.max_drawdown_gbp == null ? null : Number(r.max_drawdown_gbp),
          sharpe_ratio:
            r.sharpe_ratio == null ? null : Number(r.sharpe_ratio),
          date_range_start: r.date_range_start,
          date_range_end: r.date_range_end,
        }))}
      />
    </PageContainer>
  )
}
