import { redirect } from 'next/navigation'

import {
  getAnalyticsOverview,
  getPerformanceByBtcContext,
  getPerformanceByDirection,
  getPerformanceByPair,
  getPerformanceByTimeOfDay,
  getPnlCurve,
  getWinRateOverTime,
} from '@/app/actions/analytics'
import { getUserPreferences } from '@/app/actions/user-preferences'
import { AnalyticsFiltersBar } from '@/components/shared/AnalyticsFilters'
import { AnalyticsStatsGrid } from '@/components/shared/AnalyticsStatsGrid'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import {
  SortableChartGrid,
  type ChartPanel,
} from '@/components/shared/SortableChartGrid'
import { PerformanceByBtcContextChart } from '@/components/shared/charts/PerformanceByBtcContextChart'
import { PerformanceByDirectionChart } from '@/components/shared/charts/PerformanceByDirectionChart'
import { PerformanceByPairChart } from '@/components/shared/charts/PerformanceByPairChart'
import { PerformanceByTimeOfDayChart } from '@/components/shared/charts/PerformanceByTimeOfDayChart'
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
const TIME_OF_DAY_THRESHOLD = 10

const DEFAULT_LAYOUT = [
  'pnl_curve',
  'win_rate_over_time',
  'trade_progress',
  'performance_by_pair',
  'performance_by_direction',
  'performance_by_time_of_day',
  'performance_by_btc_context',
]

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

  const [
    overview,
    curve,
    winRate,
    perPair,
    perDirection,
    perTimeOfDay,
    perBtcContext,
    preferences,
  ] = await Promise.all([
    getAnalyticsOverview(filters),
    getPnlCurve(filters),
    getWinRateOverTime(filters),
    getPerformanceByPair(filters),
    getPerformanceByDirection(filters),
    getPerformanceByTimeOfDay(filters),
    getPerformanceByBtcContext(filters),
    getUserPreferences(),
  ])

  const hasTrades = overview.total_trades > 0
  const enoughForCharts = overview.total_trades >= CHART_UNLOCK_THRESHOLD
  const enoughForTimeOfDay = overview.total_trades >= TIME_OF_DAY_THRESHOLD
  const distinctPairs = new Set(perPair.map((p) => p.pair)).size

  // Trade span used by the progress projection. Same approach as 14a:
  // first-to-last bucketed exit dates from the curve.
  const tradeSpanDays = (() => {
    if (curve.length < 2) return null
    const first = Date.parse(curve[0]!.date)
    const last = Date.parse(curve[curve.length - 1]!.date)
    if (Number.isNaN(first) || Number.isNaN(last)) return null
    const days = (last - first) / (24 * 60 * 60 * 1000)
    return days > 0 ? days : null
  })()

  const panels: ChartPanel[] = []

  panels.push({
    id: 'pnl_curve',
    span: 'full',
    node: (
      <ChartSlot title="PnL curve" subtitle="Cumulative realised PnL">
        {enoughForCharts ? (
          <PnlCurveChart data={curve} />
        ) : (
          <ChartLockedNote
            total={overview.total_trades}
            threshold={CHART_UNLOCK_THRESHOLD}
          />
        )}
      </ChartSlot>
    ),
  })

  panels.push({
    id: 'win_rate_over_time',
    span: 'full',
    node: (
      <ChartSlot title="Win rate over time" subtitle="Rolling 20-trade window">
        {enoughForCharts ? (
          <WinRateOverTimeChart data={winRate} />
        ) : (
          <ChartLockedNote
            total={overview.total_trades}
            threshold={CHART_UNLOCK_THRESHOLD}
          />
        )}
      </ChartSlot>
    ),
  })

  panels.push({
    id: 'trade_progress',
    span: 'full',
    node: (
      <ChartSlot
        title="Trade count progress"
        subtitle="Pace toward the v1 milestone"
      >
        <TradeProgressChart
          total_trades={overview.total_trades}
          trade_span_days={tradeSpanDays}
        />
      </ChartSlot>
    ),
  })

  if (distinctPairs > 1 || (perPair.length > 0 && hasTrades)) {
    panels.push({
      id: 'performance_by_pair',
      span: 'half',
      node: (
        <ChartSlot title="By pair" subtitle="PnL contribution per asset">
          {enoughForCharts ? (
            <PerformanceByPairChart data={perPair} />
          ) : (
            <ChartLockedNote
              total={overview.total_trades}
              threshold={CHART_UNLOCK_THRESHOLD}
            />
          )}
        </ChartSlot>
      ),
    })
  }

  panels.push({
    id: 'performance_by_direction',
    span: 'half',
    node: (
      <ChartSlot title="By direction" subtitle="Long versus short">
        {enoughForCharts ? (
          <PerformanceByDirectionChart data={perDirection} />
        ) : (
          <ChartLockedNote
            total={overview.total_trades}
            threshold={CHART_UNLOCK_THRESHOLD}
          />
        )}
      </ChartSlot>
    ),
  })

  panels.push({
    id: 'performance_by_time_of_day',
    span: 'full',
    node: (
      <ChartSlot
        title="By time of day"
        subtitle="Trade count and win rate by UTC hour"
      >
        {enoughForTimeOfDay ? (
          <PerformanceByTimeOfDayChart data={perTimeOfDay} />
        ) : (
          <ChartLockedNote
            total={overview.total_trades}
            threshold={TIME_OF_DAY_THRESHOLD}
          />
        )}
      </ChartSlot>
    ),
  })

  const knownBtcContext =
    perBtcContext.up.total_trades +
    perBtcContext.ranging.total_trades +
    perBtcContext.down.total_trades
  if (knownBtcContext > 0 || perBtcContext.unknown_count > 0) {
    panels.push({
      id: 'performance_by_btc_context',
      span: 'full',
      node: (
        <ChartSlot
          title="By BTC context"
          subtitle="Trend at the moment you logged"
        >
          {enoughForCharts ? (
            <PerformanceByBtcContextChart data={perBtcContext} />
          ) : (
            <ChartLockedNote
              total={overview.total_trades}
              threshold={CHART_UNLOCK_THRESHOLD}
            />
          )}
        </ChartSlot>
      ),
    })
  }

  return (
    <div className="relative">
      {/* Faint scanline overlay specific to /analytics. Scoped here
          rather than in the global layout so other pages stay clean. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 bg-scanlines"
      />
      <CornerBracket position="top-left" />
      <CornerBracket position="top-right" />
      <CornerBracket position="bottom-left" />
      <CornerBracket position="bottom-right" />
      <div className="relative z-20">
        <PageContainer>
          <PageHeader
            title="Analytics"
            subtitle="Pattern recognition across your trades"
            rightSlot={<EngineLiveIndicator />}
          />

          <div className="flex flex-col gap-5">
            <div className="sticky top-14 z-20 -mx-1 px-1 pt-1">
              <AnalyticsFiltersBar universeSymbols={universeSymbols} />
              <div className="mt-1 h-px w-full bg-analytics-filter-fade" />
            </div>

            {!hasTrades ? (
              <Panel>
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                  <p className="font-mono text-xs uppercase tracking-widest text-white/40">
                    No data
                  </p>
                  <p className="max-w-md text-sm text-white/55">
                    Your analytics will fill in here after your first closed
                    trade. Log a few trades to see your patterns emerge.
                  </p>
                </div>
              </Panel>
            ) : (
              <>
                <AnalyticsStatsGrid overview={overview} hasTrades={hasTrades} />

                <SectionDivider />

                <SortableChartGrid
                  panels={panels}
                  defaultOrder={DEFAULT_LAYOUT}
                  initialOrder={preferences.analytics_layout}
                />
              </>
            )}
          </div>
        </PageContainer>
      </div>
    </div>
  )
}

function EngineLiveIndicator() {
  return (
    <span className="hidden items-center gap-2 rounded-md border border-white/[0.06] bg-surface px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-white/55 sm:inline-flex">
      <span
        aria-hidden
        className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent"
        style={{ filter: 'drop-shadow(0 0 4px rgba(59,130,255,0.7))' }}
      />
      Engine · v1.0 · Live
    </span>
  )
}

function CornerBracket({
  position,
}: {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
}) {
  // Pure decoration. Each corner is a 12px L-shape made of two
  // borders. Faint accent-blue, well below the scanline opacity.
  const placement: Record<typeof position, string> = {
    'top-left': 'top-2 left-2 border-t border-l',
    'top-right': 'top-2 right-2 border-t border-r',
    'bottom-left': 'bottom-2 left-2 border-b border-l',
    'bottom-right': 'bottom-2 right-2 border-b border-r',
  }
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute z-10 h-3 w-3 ${placement[position]} border-accent/30`}
    />
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

function ChartLockedNote({
  total,
  threshold,
}: {
  total: number
  threshold: number
}) {
  const remaining = Math.max(0, threshold - total)
  return (
    <div className="flex h-[160px] items-center justify-center">
      <p className="font-mono text-[11px] uppercase tracking-widest text-white/35">
        Chart unlocks at {threshold} closed trades · {remaining} to go
      </p>
    </div>
  )
}
