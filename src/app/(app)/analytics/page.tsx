import { redirect } from 'next/navigation'

import {
  getAnalyticsOverview,
  getPnlCurve,
  getWinRateOverTime,
} from '@/app/actions/analytics'
import { AnalyticsFiltersBar } from '@/components/shared/AnalyticsFilters'
import { AnalyticsStatsGrid } from '@/components/shared/AnalyticsStatsGrid'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { PnlCurveChart } from '@/components/shared/charts/PnlCurveChart'
import { TradeProgressChart } from '@/components/shared/charts/TradeProgressChart'
import { WinRateOverTimeChart } from '@/components/shared/charts/WinRateOverTimeChart'
import { Panel } from '@/components/ui/Panel'
import { createClient } from '@/lib/supabase/server'
import { parseFiltersFromSearchParams } from '@/lib/validations/analytics'

export const metadata = {
  title: 'Analytics · Dizzy Trade',
}

const CHART_UNLOCK_THRESHOLD = 5

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const filters = parseFiltersFromSearchParams(searchParams)

  const { data: universe } = await supabase
    .from('universe')
    .select('symbol')
    .eq('is_active', true)
    .order('symbol', { ascending: true })
  const universeSymbols = (universe ?? []).map((row) => String(row.symbol))

  const [overview, curve, winRate] = await Promise.all([
    getAnalyticsOverview(filters),
    getPnlCurve(filters),
    getWinRateOverTime(filters),
  ])

  const hasTrades = overview.total_trades > 0
  const enoughForCharts = overview.total_trades >= CHART_UNLOCK_THRESHOLD

  // Use the entry_at span across the filtered closed trades to
  // estimate v1 completion. The curve is bucketed by date, so the
  // distance between the first and last buckets is a good proxy.
  const tradeSpanDays = (() => {
    if (curve.length < 2) return null
    const first = Date.parse(curve[0]!.date)
    const last = Date.parse(curve[curve.length - 1]!.date)
    if (Number.isNaN(first) || Number.isNaN(last)) return null
    const days = (last - first) / (24 * 60 * 60 * 1000)
    return days > 0 ? days : null
  })()

  return (
    <PageContainer>
      <PageHeader
        title="Analytics"
        subtitle="Pattern recognition across your trades"
        rightSlot={
          <span
            aria-hidden
            className="hidden items-center gap-2 rounded-md border border-white/[0.06] bg-surface px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-white/55 sm:inline-flex"
          >
            <span
              className="h-1.5 w-1.5 rounded-full bg-accent"
              style={{ filter: 'drop-shadow(0 0 4px rgba(59,130,255,0.6))' }}
            />
            Engine · v1.0
          </span>
        }
      />

      <div className="flex flex-col gap-5">
        <div className="sticky top-14 z-10 -mx-1 px-1 pt-1">
          <AnalyticsFiltersBar universeSymbols={universeSymbols} />
        </div>

        {!hasTrades ? (
          <Panel>
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <p className="font-mono text-xs uppercase tracking-widest text-white/40">
                No data
              </p>
              <p className="max-w-md text-sm text-white/55">
                Your analytics will fill in here after your first closed trade.
                Log a few trades to see your patterns emerge.
              </p>
            </div>
          </Panel>
        ) : (
          <>
            <AnalyticsStatsGrid overview={overview} hasTrades={hasTrades} />

            <SectionDivider />

            <div className="flex flex-col gap-5">
              <ChartSlot title="PnL curve" subtitle="Cumulative realised PnL">
                {enoughForCharts ? (
                  <PnlCurveChart data={curve} />
                ) : (
                  <ChartLockedNote total={overview.total_trades} />
                )}
              </ChartSlot>

              <ChartSlot
                title="Win rate over time"
                subtitle="Rolling 20-trade window"
              >
                {enoughForCharts ? (
                  <WinRateOverTimeChart data={winRate} />
                ) : (
                  <ChartLockedNote total={overview.total_trades} />
                )}
              </ChartSlot>

              <ChartSlot
                title="Trade count progress"
                subtitle="Pace toward the v1 milestone"
              >
                <TradeProgressChart
                  total_trades={overview.total_trades}
                  trade_span_days={tradeSpanDays}
                />
              </ChartSlot>
            </div>
          </>
        )}
      </div>
    </PageContainer>
  )
}

function SectionDivider() {
  return (
    <div className="relative my-1 flex items-center">
      <span aria-hidden className="h-px w-full bg-white/[0.05]" />
      <span
        aria-hidden
        className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-accent"
        style={{ filter: 'drop-shadow(0 0 6px rgba(59,130,255,0.55))' }}
      />
    </div>
  )
}

function ChartSlot({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <Panel
      title={title}
      headerRight={
        <span className="font-mono text-[10px] uppercase tracking-widest text-white/40">
          {subtitle}
        </span>
      }
      bodyClassName="px-2 py-2"
    >
      {children}
    </Panel>
  )
}

function ChartLockedNote({ total }: { total: number }) {
  const remaining = Math.max(0, CHART_UNLOCK_THRESHOLD - total)
  return (
    <div className="flex h-[280px] items-center justify-center">
      <p className="font-mono text-[11px] uppercase tracking-widest text-white/35">
        Chart unlocks at {CHART_UNLOCK_THRESHOLD} closed trades · {remaining} to
        go
      </p>
    </div>
  )
}
