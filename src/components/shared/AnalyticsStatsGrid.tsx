import { twMerge } from 'tailwind-merge'

import type { AnalyticsOverview } from '@/app/actions/analytics'
import { TRADES_GOAL } from '@/lib/validations/analytics'

export type AnalyticsStatsGridProps = {
  overview: AnalyticsOverview
  hasTrades: boolean
}

type CardTone = 'positive' | 'negative' | 'neutral'

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

function StatValue({
  value,
  tone,
  empty,
}: {
  value: string
  tone: CardTone
  empty: boolean
}) {
  if (empty) {
    return (
      <span className="font-mono text-3xl tabular-nums text-white/35">—</span>
    )
  }
  const toneClass =
    tone === 'positive'
      ? 'text-positive'
      : tone === 'negative'
        ? 'text-negative'
        : 'text-white'
  const glow =
    tone === 'positive'
      ? '[text-shadow:0_0_18px_rgba(74,222,128,0.45)]'
      : tone === 'negative'
        ? '[text-shadow:0_0_18px_rgba(248,113,113,0.4)]'
        : '[text-shadow:0_0_18px_rgba(59,130,255,0.4)]'
  return (
    <span
      className={twMerge(
        'font-mono text-3xl font-medium tabular-nums tracking-tight',
        toneClass,
        glow,
      )}
    >
      {value}
    </span>
  )
}

function StatCard({
  label,
  value,
  subtitle,
  tone = 'neutral',
  empty,
  progressPct,
}: {
  label: string
  value: string
  subtitle: string
  tone?: CardTone
  empty: boolean
  progressPct?: number
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/[0.06] bg-surface bg-panel-lit p-4">
      <StatLabel>{label}</StatLabel>
      <StatValue value={value} tone={tone} empty={empty} />
      <span className="text-[11px] text-white/40">
        {empty ? 'No data yet' : subtitle}
      </span>
      {progressPct !== undefined ? (
        <div className="relative h-px w-full overflow-hidden bg-white/[0.06]">
          <div
            className="absolute inset-y-0 left-0 bg-accent"
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

function formatGbp(value: number): string {
  const sign = value < 0 ? '-' : value > 0 ? '+' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`
}

export function AnalyticsStatsGrid({
  overview,
  hasTrades,
}: AnalyticsStatsGridProps) {
  const empty = !hasTrades || overview.total_trades === 0
  const winRatePct = empty ? '—' : `${(overview.win_rate * 100).toFixed(0)}%`
  const avgR = empty
    ? '—'
    : `${overview.avg_r >= 0 ? '+' : ''}${overview.avg_r.toFixed(2)}R`
  const totalTrades = empty ? '—' : `${overview.total_trades}`
  const totalPnl = empty ? '—' : formatGbp(overview.total_pnl_gbp)
  const daysActive = empty ? '—' : `${overview.days_active}`

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
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <StatCard
        label="Win rate"
        value={winRatePct}
        tone={winTone}
        subtitle="Filtered window"
        empty={empty}
      />
      <StatCard
        label="Avg R"
        value={avgR}
        tone={rTone}
        subtitle="Mean reward / risk"
        empty={empty}
      />
      <StatCard
        label="Total trades"
        value={totalTrades}
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
        value={totalPnl}
        tone={pnlTone}
        subtitle="Realised in window"
        empty={empty}
      />
      <StatCard
        label="Days active"
        value={daysActive}
        subtitle="Distinct trading days"
        empty={empty}
      />
    </div>
  )
}
