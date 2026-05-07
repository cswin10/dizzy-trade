import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { computeBatchAnalyticsAction } from '@/app/actions/backtest-analytics'
import {
  getBatchBacktestAction,
  getBatchEquityCurvesAction,
} from '@/app/actions/batch-backtest'
import { BatchAnalyticsSections } from '@/components/shared/BatchAnalyticsSections'
import { BatchEquityCurveOverlay } from '@/components/shared/BatchEquityCurveOverlay'
import { BatchLeaderboard } from '@/components/shared/BatchLeaderboard'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Batch result · Dizzy Trade',
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-white/10 text-white/55',
  running: 'bg-amber-500/15 text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  failed: 'bg-red-500/15 text-red-300',
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function BatchBacktestDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const analyticsStart = Date.now()
  const [detail, curves, analyticsRes] = await Promise.all([
    getBatchBacktestAction(params.id),
    getBatchEquityCurvesAction(params.id),
    computeBatchAnalyticsAction(params.id),
  ])
  const analyticsMs = Date.now() - analyticsStart
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[batch detail] analytics computed in ${analyticsMs}ms`)
  }
  const analytics = analyticsRes.ok ? analyticsRes.data : null
  if (!detail.ok) notFound()
  const { batch, runs } = detail.data
  const config = batch.config as {
    pairs?: string[]
    timeframe?: string
    date_range_start?: string
    date_range_end?: string
    starting_capital_gbp?: number
    use_strategy_native_pairs?: boolean
  }

  return (
    <PageContainer>
      <PageHeader
        title={batch.name ?? 'Untitled batch'}
        subtitle={`${batch.strategy_definition_ids.length + batch.legacy_strategy_ids.length} strategies · ${formatDateTime(batch.created_at)}`}
        rightSlot={
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_BADGE[batch.status] ?? ''}`}
            >
              {batch.status}
            </span>
            <Link href="/backtest/batch" className="contents">
              <Button variant="ghost" className="w-auto">
                Back to batches
              </Button>
            </Link>
          </div>
        }
      />

      <section className="mb-4 grid gap-3 rounded-lg border border-white/[0.06] bg-surface p-4 text-xs sm:grid-cols-3 lg:grid-cols-6">
        <KV label="Pairs" value={(config.pairs ?? []).join(', ') || '-'} />
        <KV label="Timeframe" value={config.timeframe ?? '-'} />
        <KV
          label="Date range"
          value={
            config.date_range_start && config.date_range_end
              ? `${formatDateTime(config.date_range_start).slice(0, 11)} → ${formatDateTime(config.date_range_end).slice(0, 11)}`
              : '-'
          }
        />
        <KV
          label="Starting capital"
          value={
            config.starting_capital_gbp != null
              ? `£${config.starting_capital_gbp.toLocaleString('en-GB')}`
              : '-'
          }
        />
        <KV
          label="Pair source"
          value={
            config.use_strategy_native_pairs ? 'Strategy-native' : 'Common'
          }
        />
        <KV label="Completed" value={formatDateTime(batch.completed_at)} />
      </section>

      {batch.error_message ? (
        <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          Some strategies failed: {batch.error_message}
        </div>
      ) : null}

      <BatchLeaderboard runs={runs} />

      <section className="mt-6 rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
        <h2 className="mb-4 text-[11px] font-medium uppercase tracking-wider text-white/55">
          Equity curves
        </h2>
        <BatchEquityCurveOverlay
          series={curves.ok ? curves.series : []}
          combined={
            analytics?.combined && analytics.combined.equity_curve.length >= 2
              ? {
                  run_id: '__combined__',
                  name: `Combined (top ${analytics.combined.member_names.length})`,
                  points: analytics.combined.equity_curve,
                }
              : undefined
          }
        />
      </section>

      {analytics ? (
        <div className="mt-6 flex flex-col gap-6">
          <BatchAnalyticsSections analytics={analytics} />
        </div>
      ) : null}
    </PageContainer>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-white/45">
        {label}
      </span>
      <span className="font-mono text-white/85">{value}</span>
    </div>
  )
}
