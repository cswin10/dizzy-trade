import Link from 'next/link'

import { twMerge } from 'tailwind-merge'

import type { AnalyticsOverview, PnlCurvePoint } from '@/app/actions/analytics'
import { MiniSparkline } from '@/components/shared/charts/MiniSparkline'
import { Panel } from '@/components/ui/Panel'

export type AnalyticsDashboardWidgetProps = {
  overview: AnalyticsOverview
  curve: PnlCurvePoint[]
}

function formatGbp(value: number): string {
  const sign = value < 0 ? '-' : value > 0 ? '+' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`
}

function pnlClass(value: number): string {
  if (value > 0)
    return 'text-positive [text-shadow:0_0_18px_rgba(74,222,128,0.45)]'
  if (value < 0)
    return 'text-negative [text-shadow:0_0_18px_rgba(248,113,113,0.4)]'
  return 'text-white [text-shadow:0_0_18px_rgba(59,130,255,0.4)]'
}

export function AnalyticsDashboardWidget({
  overview,
  curve,
}: AnalyticsDashboardWidgetProps) {
  const empty = overview.total_trades === 0
  const sparkData = curve.map((p, idx) => ({
    x: idx,
    y: p.cumulative_pnl_gbp,
  }))

  return (
    <Panel
      title="Analytics · Last 30D"
      headerRight={
        <Link
          href="/analytics"
          className="font-mono text-[11px] uppercase tracking-widest text-accent transition-colors duration-150 hover:text-accent/80"
        >
          View full analytics →
        </Link>
      }
    >
      {empty ? (
        <p className="py-6 text-center text-sm text-white/45">
          Trade analytics will appear here after your first closed trade.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-4">
            <Stat
              label="Win rate"
              value={`${(overview.win_rate * 100).toFixed(0)}%`}
              tone={overview.win_rate >= 0.33 ? 'positive' : 'neutral'}
            />
            <Stat
              label="Avg R"
              value={`${overview.avg_r >= 0 ? '+' : ''}${overview.avg_r.toFixed(2)}R`}
              tone={
                overview.avg_r > 0
                  ? 'positive'
                  : overview.avg_r < 0
                    ? 'negative'
                    : 'neutral'
              }
            />
            <Stat
              label="Total PnL"
              value={formatGbp(overview.total_pnl_gbp)}
              tone={
                overview.total_pnl_gbp > 0
                  ? 'positive'
                  : overview.total_pnl_gbp < 0
                    ? 'negative'
                    : 'neutral'
              }
            />
          </div>
          <MiniSparkline
            data={sparkData}
            ariaLabel="Cumulative PnL over the last 30 days"
            className="-mx-1"
          />
        </div>
      )}
    </Panel>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'positive' | 'negative' | 'neutral'
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-widest text-white/40">
        {label}
      </span>
      <span
        className={twMerge(
          'font-mono text-2xl font-medium tabular-nums',
          tone === 'positive' &&
            'text-positive [text-shadow:0_0_14px_rgba(74,222,128,0.45)]',
          tone === 'negative' &&
            'text-negative [text-shadow:0_0_14px_rgba(248,113,113,0.4)]',
          tone === 'neutral' && pnlClass(0),
        )}
      >
        {value}
      </span>
    </div>
  )
}
