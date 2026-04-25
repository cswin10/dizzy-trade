import { twMerge } from 'tailwind-merge'

import type { AnalyticsOverview } from '@/app/actions/analytics'
import {
  AnimatedStatValue,
  type StatFormat,
} from '@/components/shared/charts/AnimatedStatValue'
import { TRADES_GOAL } from '@/lib/validations/analytics'

export type AnalyticsStatsGridProps = {
  overview: AnalyticsOverview
  hasTrades: boolean
}

type CardTone = 'positive' | 'negative' | 'neutral'

const TONE_GLOW: Record<CardTone, string> = {
  positive: 'text-positive [text-shadow:0_0_18px_rgba(74,222,128,0.45)]',
  negative: 'text-negative [text-shadow:0_0_18px_rgba(248,113,113,0.4)]',
  neutral: 'text-white [text-shadow:0_0_18px_rgba(59,130,255,0.4)]',
}

function StatLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-white/45">
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full bg-accent"
        style={{ filter: 'drop-shadow(0 0 4px rgba(59,130,255,0.55))' }}
      />
      <span>{children}</span>
    </span>
  )
}

function StatCard({
  label,
  value,
  format,
  subtitle,
  tone = 'neutral',
  empty,
  progressPct,
}: {
  label: string
  value: number
  format: StatFormat
  subtitle: string
  tone?: CardTone
  empty: boolean
  progressPct?: number
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/[0.06] bg-surface bg-panel-lit p-4">
      <StatLabel>{label}</StatLabel>
      <AnimatedStatValue
        value={value}
        format={format}
        empty={empty}
        className={empty ? undefined : TONE_GLOW[tone]}
      />
      <span className="text-[11px] text-white/40">
        {empty ? 'No data yet' : subtitle}
      </span>
      {progressPct !== undefined ? (
        <div className="relative h-px w-full overflow-hidden bg-white/[0.06]">
          <div
            className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-500 ease-out"
            style={{
              width: `${Math.min(100, Math.max(0, progressPct * 100))}%`,
              filter: 'drop-shadow(0 0 4px rgba(59,130,255,0.55))',
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

export function AnalyticsStatsGrid({
  overview,
  hasTrades,
}: AnalyticsStatsGridProps) {
  const empty = !hasTrades || overview.total_trades === 0

  const winTone: CardTone = empty
    ? 'neutral'
    : overview.win_rate >= 0.33
      ? 'positive'
      : 'negative'
  const rTone: CardTone = empty
    ? 'neutral'
    : overview.avg_r > 0
      ? 'positive'
      : overview.avg_r < 0
        ? 'negative'
        : 'neutral'
  const pnlTone: CardTone = empty
    ? 'neutral'
    : overview.total_pnl_gbp > 0
      ? 'positive'
      : overview.total_pnl_gbp < 0
        ? 'negative'
        : 'neutral'

  return (
    <div className={twMerge('grid grid-cols-2 gap-3 md:grid-cols-5')}>
      <StatCard
        label="Win rate"
        value={overview.win_rate}
        format="percent"
        tone={winTone}
        subtitle="Filtered window"
        empty={empty}
      />
      <StatCard
        label="Avg R"
        value={overview.avg_r}
        format="r-multiple"
        tone={rTone}
        subtitle="Mean reward / risk"
        empty={empty}
      />
      <StatCard
        label="Total trades"
        value={overview.total_trades}
        format="integer"
        subtitle={
          empty
            ? 'Goal: 50 trades'
            : `${overview.total_trades} of ${TRADES_GOAL} toward v1 goal`
        }
        empty={empty}
        progressPct={empty ? undefined : overview.trades_progress_pct}
      />
      <StatCard
        label="Total PnL"
        value={overview.total_pnl_gbp}
        format="currency-gbp"
        tone={pnlTone}
        subtitle="Realised in window"
        empty={empty}
      />
      <StatCard
        label="Days active"
        value={overview.days_active}
        format="integer"
        subtitle="Distinct trading days"
        empty={empty}
      />
    </div>
  )
}
