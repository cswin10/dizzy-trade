// Side-by-side comparison of train and test metrics so the operator
// can see at a glance whether a strategy generalises out of sample.
// The headline status line below the cards is the most important
// part: a clear green/red verdict the operator does not have to do
// arithmetic to read.

import { twMerge } from 'tailwind-merge'

import type { BacktestMetrics } from '@/lib/backtest/types'

export type BacktestTrainTestPanelProps = {
  trainMetrics: BacktestMetrics | null
  testMetrics: BacktestMetrics | null
  // null when the split check could not produce a verdict (too few
  // trades on at least one side). Render as "insufficient data"
  // rather than collapsing to either green or red.
  overfitWarning: boolean | null
}

const MIN_TRADES_FOR_SPLIT_VERDICT = 5

function formatGbp(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const sign = value < 0 ? '-' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    maximumFractionDigits: 0,
  })}`
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

function formatNumber(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

export function BacktestTrainTestPanel({
  trainMetrics,
  testMetrics,
  overfitWarning,
}: BacktestTrainTestPanelProps) {
  if (!trainMetrics || !testMetrics) {
    return null
  }

  return (
    <div className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
      <h2 className="mb-4 text-[11px] font-medium uppercase tracking-wider text-white/55">
        Train and test split
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <SplitCard label="Train" metrics={trainMetrics} />
        <SplitCard label="Test" metrics={testMetrics} />
      </div>
      {(() => {
        const tooFewTrades =
          trainMetrics.total_trades < MIN_TRADES_FOR_SPLIT_VERDICT ||
          testMetrics.total_trades < MIN_TRADES_FOR_SPLIT_VERDICT
        const insufficient = overfitWarning === null || tooFewTrades
        const tone = insufficient
          ? 'border-white/10 bg-white/[0.03] text-white/55'
          : overfitWarning
            ? 'border-red-500/30 bg-red-500/10 text-red-200'
            : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
        const message = insufficient
          ? 'Insufficient data: need at least 5 trades on each side of the split for a verdict.'
          : overfitWarning
            ? 'OVERFIT WARNING: Train metrics significantly outperform test. This strategy may not work in live trading.'
            : 'Strategy holds up out of sample. Train and test metrics are consistent.'
        return (
          <div className={twMerge('mt-4 rounded-md border p-3 text-sm', tone)}>
            {message}
          </div>
        )
      })()}
    </div>
  )

  function SplitCard({
    label,
    metrics,
  }: {
    label: string
    metrics: BacktestMetrics
  }) {
    return (
      <div className="rounded-md border border-white/[0.06] bg-surface-2 p-4">
        <div className="mb-3 text-[10px] uppercase tracking-wider text-white/55">
          {label}
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-white/65">
          <Row label="Trades" value={metrics.total_trades.toString()} />
          <Row label="Win rate" value={formatPct(metrics.win_rate)} />
          <Row label="Avg R" value={formatNumber(metrics.avg_r)} />
          <Row label="Total PnL" value={formatGbp(metrics.total_pnl_gbp)} />
          <Row label="Max DD" value={formatGbp(metrics.max_drawdown_gbp)} />
          <Row label="Sharpe" value={formatNumber(metrics.sharpe_ratio)} />
        </dl>
      </div>
    )
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-white/45">{label}</dt>
      <dd className="text-right font-mono text-white/85">{value}</dd>
    </>
  )
}
