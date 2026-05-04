import { notFound, redirect } from 'next/navigation'

import { DeployStrategyWizard } from '@/components/shared/DeployStrategyWizard'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const metadata = { title: 'Deploy strategy · Dizzy Trade' }

// Pre-load the strategy + last 10 backtest runs against it so the
// wizard can render the "backtest justification" stage without a
// client-side round-trip.
export default async function DeployStrategyPage({
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
  const [definitionRes, universeRes, recentBacktestsRes] = await Promise.all([
    service
      .from('strategy_definitions')
      .select('id, name, pairs, timeframe, definition, deployment_status')
      .eq('id', params.id)
      .single(),
    service
      .from('universe')
      .select('symbol')
      .eq('is_active', true)
      .order('symbol', { ascending: true }),
    service
      .from('backtest_runs')
      .select(
        'id, name, total_trades, win_rate, avg_r, total_pnl_gbp, max_drawdown_gbp, sharpe_ratio, created_at, status',
      )
      .eq('strategy_definition_id', params.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(10),
  ])
  const definition = definitionRes.data
  if (!definition) notFound()
  // Universe powers the chip list. The strategy's own pairs are
  // pre-ticked so the operator's default is "deploy on what was
  // backtested" but they can extend or trim from there.
  const pairUniverse = (universeRes.data ?? []).map((r) => String(r.symbol))
  const recentBacktests = recentBacktestsRes.data ?? []

  return (
    <PageContainer>
      <PageHeader
        title={`Deploy "${definition.name}" live`}
        subtitle="Configure live risk, pairs, and guardrails. Phase 1 routes orders through a mock exchange client; Phase 2 will swap in real Hyperliquid."
      />
      <DeployStrategyWizard
        strategy={{
          id: definition.id,
          name: definition.name,
          pairs: (definition.pairs ?? []) as string[],
          timeframe: String(definition.timeframe),
          deployment_status: definition.deployment_status as
            | 'draft'
            | 'live'
            | 'paused'
            | 'archived',
        }}
        pairUniverse={pairUniverse}
        recentBacktests={recentBacktests.map((r) => ({
          id: r.id,
          name: r.name,
          total_trades: r.total_trades ?? null,
          win_rate: r.win_rate == null ? null : Number(r.win_rate),
          avg_r: r.avg_r == null ? null : Number(r.avg_r),
          total_pnl_gbp:
            r.total_pnl_gbp == null ? null : Number(r.total_pnl_gbp),
          max_drawdown_gbp:
            r.max_drawdown_gbp == null ? null : Number(r.max_drawdown_gbp),
          sharpe_ratio: r.sharpe_ratio == null ? null : Number(r.sharpe_ratio),
          created_at: r.created_at,
        }))}
      />
    </PageContainer>
  )
}
