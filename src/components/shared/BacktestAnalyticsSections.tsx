'use client'

// Sections A, C, D, E, F of the backtest detail-page analytics
// (Section B - per-pair full - lives in BacktestPerformanceByPairTable
// because it extends an existing component in place). All sections
// are <details> elements default-open so the operator can collapse
// the parts they don't want to see without losing them entirely.
//
// The component is a pure function of the analytics payload returned
// by computeBacktestAnalyticsAction - it does no fetching of its
// own. The parent page is expected to call the action server-side
// and pass the result down as a prop.

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { twMerge } from 'tailwind-merge'

import type {
  BacktestAnalytics,
  ExitReasonRow,
  HourBucket,
  MonthlyReturnRow,
} from '@/lib/backtest/analytics'

export type BacktestAnalyticsSectionsProps = {
  analytics: BacktestAnalytics
}

function formatGbp(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-'
  }
  const sign = value < 0 ? '-' : value > 0 ? '+' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    maximumFractionDigits: 0,
  })}`
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-'
  }
  return `${(value * 100).toFixed(1)}%`
}

function formatNumber(
  value: number | null | undefined,
  digits = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-'
  }
  return value.toFixed(digits)
}

export function BacktestAnalyticsSections({
  analytics,
}: BacktestAnalyticsSectionsProps) {
  return (
    <>
      <MonthlyReturns monthly={analytics.monthly} />
      <HourHeatmap hour={analytics.hour} />
      <ExitReasonDistribution exitReasons={analytics.exit_reasons} />
      <DrawdownProfileSection drawdown={analytics.drawdown} />
      <StreaksSection streaks={analytics.streaks} />
    </>
  )
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

// --- A. Returns by month --------------------------------------

function MonthlyReturns({
  monthly,
}: {
  monthly: BacktestAnalytics['monthly']
}) {
  return (
    <SectionShell title="Returns by month">
      {monthly.rows.length === 0 ? (
        <p className="text-xs text-white/55">
          No completed trades in this period.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded border border-white/[0.06]">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-white/45">
                <tr>
                  <th className="px-3 py-2 text-left">Month</th>
                  <th className="px-3 py-2 text-right">Trades</th>
                  <th className="px-3 py-2 text-right">Win rate</th>
                  <th className="px-3 py-2 text-right">Total PnL</th>
                  <th className="px-3 py-2 text-right">Avg R</th>
                </tr>
              </thead>
              <tbody>
                {monthly.rows.map((row) => (
                  <MonthlyRow key={row.month_iso} row={row} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-white/55">
            Best month: {monthly.best_month_label ?? '-'}{' '}
            ({formatGbp(monthly.best_month_pnl)}). Worst month:{' '}
            {monthly.worst_month_label ?? '-'}{' '}
            ({formatGbp(monthly.worst_month_pnl)}). Months profitable:{' '}
            {monthly.profitable_months} of {monthly.total_months}.
          </p>
        </>
      )}
    </SectionShell>
  )
}

function MonthlyRow({ row }: { row: MonthlyReturnRow }) {
  const tone =
    row.total_pnl_gbp > 0
      ? 'bg-emerald-500/[0.04] text-emerald-200/85'
      : row.total_pnl_gbp < 0
        ? 'bg-red-500/[0.04] text-red-200/85'
        : 'text-white/85'
  return (
    <tr className={twMerge('border-t border-white/[0.04]', tone)}>
      <td className="px-3 py-2 font-medium">{row.month_label}</td>
      <td className="px-3 py-2 text-right font-mono">{row.trades}</td>
      <td className="px-3 py-2 text-right font-mono">
        {formatPct(row.win_rate)}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {formatGbp(row.total_pnl_gbp)}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {formatNumber(row.avg_r)}
      </td>
    </tr>
  )
}

// --- C. Time-of-day heatmap -----------------------------------

function HourHeatmap({ hour }: { hour: BacktestAnalytics['hour'] }) {
  const populated = hour.rows.filter((r) => r.trades > 0)
  return (
    <SectionShell title="Time-of-day heatmap (UTC)">
      {populated.length === 0 ? (
        <p className="text-xs text-white/55">No trades by hour to plot.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded border border-white/[0.06]">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-white/45">
                <tr>
                  <th className="px-3 py-2 text-left">Hour</th>
                  <th className="px-3 py-2 text-right">Trades</th>
                  <th className="px-3 py-2 text-right">Win rate</th>
                  <th className="px-3 py-2 text-right">Avg R</th>
                  <th className="px-3 py-2 text-right">Total PnL</th>
                </tr>
              </thead>
              <tbody>
                {hour.rows.map((row) => (
                  <HourRow
                    key={row.hour_utc}
                    row={row}
                    baseline={hour.pnl_baseline}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-white/55">
            Best hours: {hour.best_hour_range ?? '-'}. Worst hours:{' '}
            {hour.worst_hour_range ?? '-'}.{' '}
            <span className="text-white/35">
              Rows with fewer than 3 trades are dimmed; sample is too small to
              read into.
            </span>
          </p>
        </>
      )}
    </SectionShell>
  )
}

function HourRow({
  row,
  baseline,
}: {
  row: HourBucket
  baseline: number
}) {
  const empty = row.trades === 0
  const small = row.small_sample
  const above = !empty && !small && row.total_pnl_gbp > baseline
  const below = !empty && !small && row.total_pnl_gbp < baseline
  const tone = empty
    ? 'text-white/30'
    : small
      ? 'text-white/45'
      : above
        ? 'bg-emerald-500/[0.05] text-emerald-200/85'
        : below
          ? 'bg-red-500/[0.05] text-red-200/85'
          : 'text-white/85'
  return (
    <tr className={twMerge('border-t border-white/[0.04]', tone)}>
      <td className="px-3 py-2 font-mono">
        {String(row.hour_utc).padStart(2, '0')}:00
      </td>
      <td className="px-3 py-2 text-right font-mono">{row.trades}</td>
      <td className="px-3 py-2 text-right font-mono">
        {row.trades > 0 ? formatPct(row.win_rate) : '-'}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {row.trades > 0 ? formatNumber(row.avg_r) : '-'}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {row.trades > 0 ? formatGbp(row.total_pnl_gbp) : '-'}
      </td>
    </tr>
  )
}

// --- D. Exit reason distribution ------------------------------

const EXIT_REASON_LABELS: Record<string, string> = {
  stop_hit: 'Stop hit',
  target_hit: 'Target hit',
  timeout: 'Timeout',
  open_at_period_end: 'Open at period end',
  rules_blocked: 'Rules blocked',
}

function ExitReasonDistribution({
  exitReasons,
}: {
  exitReasons: BacktestAnalytics['exit_reasons']
}) {
  const timeoutAvgR =
    exitReasons.rows.find((r) => r.exit_reason === 'timeout')?.avg_r ?? null
  const stopAvgR =
    exitReasons.rows.find((r) => r.exit_reason === 'stop_hit')?.avg_r ?? null
  return (
    <SectionShell title="Exit reasons">
      {exitReasons.rows.length === 0 ? (
        <p className="text-xs text-white/55">No completed trades.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded border border-white/[0.06]">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-white/45">
                <tr>
                  <th className="px-3 py-2 text-left">Reason</th>
                  <th className="px-3 py-2 text-right">Count</th>
                  <th className="px-3 py-2 text-right">% of trades</th>
                  <th className="px-3 py-2 text-right">Avg R</th>
                  <th className="px-3 py-2 text-right">Total PnL</th>
                </tr>
              </thead>
              <tbody>
                {exitReasons.rows.map((row) => (
                  <ExitReasonRowView key={row.exit_reason} row={row} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-white/55">
            {formatPct(exitReasons.stop_hit_share)} hit stop,{' '}
            {formatPct(exitReasons.target_hit_share)} hit target,{' '}
            {formatPct(exitReasons.timeout_share)} timed out.
            {timeoutAvgR !== null && stopAvgR !== null ? (
              <>
                {' '}
                Avg R on timeouts: {formatNumber(timeoutAvgR)} (vs{' '}
                {formatNumber(stopAvgR)} on stops).
              </>
            ) : null}
          </p>
        </>
      )}
    </SectionShell>
  )
}

function ExitReasonRowView({ row }: { row: ExitReasonRow }) {
  const tone =
    row.total_pnl_gbp > 0
      ? 'text-emerald-200/85'
      : row.total_pnl_gbp < 0
        ? 'text-red-200/85'
        : 'text-white/85'
  return (
    <tr className={twMerge('border-t border-white/[0.04]', tone)}>
      <td className="px-3 py-2 font-medium">
        {EXIT_REASON_LABELS[row.exit_reason] ?? row.exit_reason}
      </td>
      <td className="px-3 py-2 text-right font-mono">{row.count}</td>
      <td className="px-3 py-2 text-right font-mono">
        {formatPct(row.share_of_trades)}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {formatNumber(row.avg_r)}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {formatGbp(row.total_pnl_gbp)}
      </td>
    </tr>
  )
}

// --- E. Drawdown profile --------------------------------------

function DrawdownProfileSection({
  drawdown,
}: {
  drawdown: BacktestAnalytics['drawdown']
}) {
  const data = drawdown.series.map((p) => ({
    t: new Date(p.exit_at_iso).getTime(),
    drawdown_gbp: p.drawdown_gbp,
  }))
  const recoveryTone =
    drawdown.recovery_factor === null
      ? 'text-white/85'
      : drawdown.recovery_factor >= 2
        ? 'text-emerald-300'
        : drawdown.recovery_factor >= 1
          ? 'text-white/85'
          : 'text-red-300'
  return (
    <SectionShell title="Drawdown profile">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Stat
          label="Max drawdown"
          value={formatGbp(-Math.abs(drawdown.max_drawdown_gbp))}
          tone="negative"
        />
        <Stat
          label="Drawdown duration"
          value={`${drawdown.max_drawdown_duration_days.toFixed(1)} days`}
        />
        <Stat
          label="Time in drawdown"
          value={`${drawdown.time_in_drawdown_pct.toFixed(1)}%`}
        />
        <Stat
          label="Recovery factor"
          value={
            drawdown.recovery_factor === null
              ? '-'
              : drawdown.recovery_factor.toFixed(2)
          }
          valueClassName={recoveryTone}
        />
      </div>
      {data.length >= 2 ? (
        <div className="mt-4 h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F87171" stopOpacity={0.0} />
                  <stop offset="100%" stopColor="#F87171" stopOpacity={0.4} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1F2937" strokeOpacity={0.5} />
              <XAxis
                dataKey="t"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(t) =>
                  new Date(t).toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                  })
                }
                tick={{ fill: '#94A3B8', fontSize: 10 }}
              />
              <YAxis
                tick={{ fill: '#94A3B8', fontSize: 10 }}
                tickFormatter={(v) => formatGbp(v)}
              />
              <Tooltip
                contentStyle={{
                  background: '#0F172A',
                  border: '1px solid #1F2937',
                  fontSize: 11,
                }}
                labelFormatter={(t) =>
                  new Date(t as number).toLocaleString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                }
                formatter={(value: number) => [formatGbp(value), 'Drawdown']}
              />
              <Area
                type="monotone"
                dataKey="drawdown_gbp"
                stroke="#F87171"
                strokeWidth={1.5}
                fill="url(#ddFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="mt-3 text-xs text-white/55">
          Need at least two completed trades to plot a drawdown curve.
        </p>
      )}
    </SectionShell>
  )
}

function Stat({
  label,
  value,
  tone,
  valueClassName,
}: {
  label: string
  value: string
  tone?: 'positive' | 'negative'
  valueClassName?: string
}) {
  return (
    <div className="rounded border border-white/[0.06] bg-surface p-3">
      <div className="text-[10px] uppercase tracking-wider text-white/45">
        {label}
      </div>
      <div
        className={twMerge(
          'mt-1 font-mono text-sm',
          tone === 'positive' && 'text-emerald-300',
          tone === 'negative' && 'text-red-300',
          !tone && 'text-white/90',
          valueClassName,
        )}
      >
        {value}
      </div>
    </div>
  )
}

// --- F. Streak analysis ---------------------------------------

function StreaksSection({
  streaks,
}: {
  streaks: BacktestAnalytics['streaks']
}) {
  const currentLabel =
    streaks.current_streak === 0
      ? '-'
      : streaks.current_streak > 0
        ? `${streaks.current_streak} wins`
        : `${Math.abs(streaks.current_streak)} losses`
  return (
    <SectionShell title="Streak analysis">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat
          label="Max consecutive wins"
          value={String(streaks.max_consecutive_wins)}
          tone="positive"
        />
        <Stat
          label="Max consecutive losses"
          value={String(streaks.max_consecutive_losses)}
          tone="negative"
        />
        <Stat
          label="Avg winning streak"
          value={formatNumber(streaks.avg_winning_streak_length)}
        />
        <Stat
          label="Avg losing streak"
          value={formatNumber(streaks.avg_losing_streak_length)}
        />
        <Stat label="Current streak" value={currentLabel} />
      </div>
      {streaks.outcome_sequence.length > 0 ? (
        <div className="mt-4">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-white/45">
            Outcome sequence ({streaks.outcome_sequence.length} trades)
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-sm border border-white/[0.06]">
            {streaks.outcome_sequence.map((o, i) => (
              <span
                key={i}
                title={`#${i + 1} ${o}`}
                className={twMerge(
                  'h-full flex-1',
                  o === 'win' && 'bg-emerald-500/70',
                  o === 'loss' && 'bg-red-500/70',
                  o === 'breakeven' && 'bg-white/15',
                )}
              />
            ))}
          </div>
        </div>
      ) : null}
    </SectionShell>
  )
}
