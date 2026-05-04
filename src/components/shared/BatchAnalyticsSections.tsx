'use client'

// Sections G (correlation matrix) and H (combined portfolio) for
// the batch detail page. The component is a pure function of the
// BatchAnalytics payload returned by computeBatchAnalyticsAction.
// Both sections are rendered inside <details> elements default-open
// so the operator can collapse them but they are findable on first
// load.

import { twMerge } from 'tailwind-merge'

import type {
  BatchAnalytics,
  CombinedPortfolio,
  CorrelationCell,
  CorrelationMatrix,
} from '@/lib/backtest/analytics'

export type BatchAnalyticsSectionsProps = {
  analytics: BatchAnalytics
}

function formatGbp(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  const sign = value < 0 ? '-' : value > 0 ? '+' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    maximumFractionDigits: 0,
  })}`
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return `${(value * 100).toFixed(1)}%`
}

function formatNumber(
  value: number | null | undefined,
  digits = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }
  return value.toFixed(digits)
}

function SectionShell({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5"
    >
      <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-wider text-white/55">
        {title}
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  )
}

export function BatchAnalyticsSections({
  analytics,
}: BatchAnalyticsSectionsProps) {
  return (
    <>
      {analytics.combined ? (
        <CombinedPortfolioSection combined={analytics.combined} />
      ) : null}
      {analytics.correlation ? (
        <CorrelationMatrixSection matrix={analytics.correlation} />
      ) : null}
    </>
  )
}

// --- G. Correlation matrix ------------------------------------

function correlationToColour(c: number): string {
  // Linear blend on the magnitude with sign-driven hue. White at 0,
  // emerald at -1 (anti-correlated, good for diversification),
  // amber at +1 (correlated, less diversification benefit). Stops
  // are tuned for the bg-surface backdrop.
  const clamped = Math.max(-1, Math.min(1, c))
  if (clamped >= 0) {
    const alpha = clamped
    return `rgba(248, 113, 113, ${alpha * 0.6})`
  }
  const alpha = -clamped
  return `rgba(74, 222, 128, ${alpha * 0.6})`
}

function CorrelationMatrixSection({ matrix }: { matrix: CorrelationMatrix }) {
  const cells = new Map<string, CorrelationCell>()
  for (const cell of matrix.cells) {
    cells.set(`${cell.a_run_id}|${cell.b_run_id}`, cell)
  }
  return (
    <SectionShell title="Strategy correlation matrix">
      <p className="mb-3 text-[11px] text-white/55">
        Pearson correlation of daily PnL across strategies. Green cells are
        anti-correlated (good for diversification); red cells are correlated
        (running both adds little). Diagonal is always 1.0.
      </p>
      <div className="overflow-x-auto rounded border border-white/[0.06]">
        <table className="text-[11px]">
          <thead>
            <tr>
              <th className="px-2 py-2 text-left text-[10px] uppercase tracking-wider text-white/45">
                {' '}
              </th>
              {matrix.run_names.map((name, i) => (
                <th
                  key={`col-${i}`}
                  className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-white/55"
                  title={name}
                >
                  <span className="block max-w-[120px] truncate">{name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.run_ids.map((rowId, i) => (
              <tr key={`row-${i}`} className="border-t border-white/[0.04]">
                <td
                  className="px-2 py-1 text-left font-medium text-white/75"
                  title={matrix.run_names[i]}
                >
                  <span className="block max-w-[160px] truncate">
                    {matrix.run_names[i]}
                  </span>
                </td>
                {matrix.run_ids.map((colId, j) => {
                  const cell = cells.get(`${rowId}|${colId}`)
                  const r = cell?.correlation ?? null
                  const bg =
                    r === null
                      ? 'transparent'
                      : i === j
                        ? 'rgba(255,255,255,0.05)'
                        : correlationToColour(r)
                  return (
                    <td
                      key={`cell-${i}-${j}`}
                      className="px-2 py-1 text-center font-mono text-white/85"
                      style={{ backgroundColor: bg }}
                      title={`${matrix.run_names[i]} ↔ ${matrix.run_names[j]}: ${r === null ? 'n/a' : r.toFixed(3)}`}
                    >
                      {r === null ? '—' : r.toFixed(2)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 space-y-1 text-[11px] text-white/55">
        {matrix.most_uncorrelated_pair ? (
          <p>
            Most uncorrelated pair: {matrix.most_uncorrelated_pair.a_name} vs{' '}
            {matrix.most_uncorrelated_pair.b_name} (corr{' '}
            {matrix.most_uncorrelated_pair.correlation.toFixed(2)}). Good
            diversification.
          </p>
        ) : null}
        {matrix.most_correlated_pair ? (
          <p>
            Most correlated pair: {matrix.most_correlated_pair.a_name} vs{' '}
            {matrix.most_correlated_pair.b_name} (corr{' '}
            {matrix.most_correlated_pair.correlation.toFixed(2)}). Running both
            adds little.
          </p>
        ) : null}
      </div>
    </SectionShell>
  )
}

// --- H. Combined portfolio ------------------------------------

function CombinedPortfolioSection({
  combined,
}: {
  combined: CombinedPortfolio
}) {
  const recoveryTone =
    combined.recovery_factor === null
      ? 'text-white/85'
      : combined.recovery_factor >= 2
        ? 'text-emerald-300'
        : combined.recovery_factor >= 1
          ? 'text-white/85'
          : 'text-red-300'
  const pnlTone =
    combined.total_pnl_gbp > 0
      ? 'text-emerald-300'
      : combined.total_pnl_gbp < 0
        ? 'text-red-300'
        : 'text-white/85'
  return (
    <SectionShell title="Combined portfolio (top 3 strategies)">
      <p className="mb-3 text-[11px] text-white/55">
        Simulates running the three highest-PnL strategies simultaneously,
        splitting allocated risk equally. Combined PnL is the sum of
        individual PnLs; combined drawdown is computed from the day-by-day
        merged equity curve, so concurrent drawdowns make it larger than any
        single strategy and offsetting strategies make it smaller.
      </p>
      <div className="rounded border border-accent/30 bg-accent/[0.05] p-3">
        <div className="text-[10px] uppercase tracking-wider text-white/45">
          Members
        </div>
        <div className="mt-1 text-sm text-white/85">
          {combined.member_names.join(', ')}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <CombinedStat label="Trades" value={String(combined.total_trades)} />
        <CombinedStat
          label="Win rate"
          value={formatPct(combined.win_rate)}
        />
        <CombinedStat
          label="Total PnL"
          value={formatGbp(combined.total_pnl_gbp)}
          valueClassName={pnlTone}
        />
        <CombinedStat
          label="Max drawdown"
          value={formatGbp(-Math.abs(combined.max_drawdown_gbp))}
          valueClassName="text-red-300"
        />
        <CombinedStat
          label="Sharpe"
          value={formatNumber(combined.sharpe_ratio)}
        />
        <CombinedStat
          label="Recovery factor"
          value={
            combined.recovery_factor === null
              ? '—'
              : combined.recovery_factor.toFixed(2)
          }
          valueClassName={recoveryTone}
        />
        <CombinedStat
          label="Wins / losses"
          value={`${combined.wins} / ${combined.losses}`}
        />
      </div>
      {combined.equity_curve.length >= 2 ? (
        <div className="mt-4 text-[11px] text-white/45">
          Combined equity curve runs from{' '}
          {new Date(combined.equity_curve[0]!.t).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
          })}{' '}
          to{' '}
          {new Date(
            combined.equity_curve[combined.equity_curve.length - 1]!.t,
          ).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
          })}{' '}
          ({combined.equity_curve.length} day points). Overlaid in the equity
          curve chart above as a thicker stroke.
        </div>
      ) : null}
    </SectionShell>
  )
}

function CombinedStat({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="rounded border border-white/[0.06] bg-surface p-3">
      <div className="text-[10px] uppercase tracking-wider text-white/45">
        {label}
      </div>
      <div
        className={twMerge(
          'mt-1 font-mono text-sm text-white/90',
          valueClassName,
        )}
      >
        {value}
      </div>
    </div>
  )
}
