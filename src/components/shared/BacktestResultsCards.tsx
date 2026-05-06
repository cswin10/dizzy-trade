// Top-of-results stats grid: a single horizontal card row showing the
// six headline numbers an operator is most likely to scan first.

import { type ReactNode } from 'react'

import { twMerge } from 'tailwind-merge'

export type BacktestResultsCardsProps = {
  totalTrades: number | null
  winRate: number | null
  avgR: number | null
  totalPnlGbp: number | null
  maxDrawdownGbp: number | null
  sharpeRatio: number | null
}

function formatGbp(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-'
  const sign = value < 0 ? '-' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    maximumFractionDigits: 0,
  })}`
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-'
  return `${(value * 100).toFixed(1)}%`
}

function formatNumber(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '-'
  return value.toFixed(digits)
}

export function BacktestResultsCards({
  totalTrades,
  winRate,
  avgR,
  totalPnlGbp,
  maxDrawdownGbp,
  sharpeRatio,
}: BacktestResultsCardsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Card label="Total trades" value={totalTrades?.toString() ?? '-'} />
      <Card label="Win rate" value={formatPct(winRate)} />
      <Card label="Avg R" value={formatNumber(avgR)} />
      <Card
        label="Total PnL"
        value={formatGbp(totalPnlGbp)}
        accent={
          totalPnlGbp != null
            ? totalPnlGbp > 0
              ? 'positive'
              : totalPnlGbp < 0
                ? 'negative'
                : 'neutral'
            : 'neutral'
        }
      />
      <Card
        label="Max drawdown"
        value={
          maxDrawdownGbp != null
            ? `-${formatGbp(maxDrawdownGbp).replace('-', '')}`
            : '-'
        }
        accent="negative"
      />
      <Card label="Sharpe" value={formatNumber(sharpeRatio)} />
    </div>
  )
}

function Card({
  label,
  value,
  accent = 'neutral',
}: {
  label: string
  value: ReactNode
  accent?: 'positive' | 'negative' | 'neutral'
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-surface p-4">
      <div className="text-[10px] uppercase tracking-wider text-white/45">
        {label}
      </div>
      <div
        className={twMerge(
          'mt-2 font-mono text-lg text-white',
          accent === 'positive' && 'text-emerald-300',
          accent === 'negative' && 'text-red-300',
        )}
      >
        {value}
      </div>
    </div>
  )
}
