'use client'

import { twMerge } from 'tailwind-merge'

import type { PerformanceByDirection } from '@/app/actions/analytics'

export type PerformanceByDirectionChartProps = {
  data: PerformanceByDirection
}

function formatGbp(value: number): string {
  const sign = value < 0 ? '-' : value > 0 ? '+' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

function formatRr(value: number): string {
  if (!Number.isFinite(value)) return '0.00R'
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${Math.abs(value).toFixed(2)}R`
}

type Side = 'long' | 'short'

function ArrowIcon({ side }: { side: Side }) {
  const path =
    side === 'long' ? 'M12 4 L20 14 L4 14 Z' : 'M12 20 L20 10 L4 10 Z'
  const colour = side === 'long' ? '#4ADE80' : '#F87171'
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path d={path} fill={colour} fillOpacity={0.85} />
    </svg>
  )
}

function DirectionCard({
  side,
  bucket,
  contributionPct,
}: {
  side: Side
  bucket: PerformanceByDirection['long']
  contributionPct: number
}) {
  const empty = bucket.total_trades === 0
  const tone = side === 'long' ? 'text-positive' : 'text-negative'
  const accent = side === 'long' ? 'border-positive/25' : 'border-negative/25'
  const barColour = side === 'long' ? 'bg-positive' : 'bg-negative'
  return (
    <div
      className={twMerge(
        'flex flex-col gap-3 rounded-lg border bg-surface bg-panel-lit p-4',
        accent,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-white/55">
          <ArrowIcon side={side} />
          <span>{side === 'long' ? 'Long' : 'Short'}</span>
        </span>
        <span className={twMerge('font-mono text-[11px] tabular-nums', tone)}>
          {empty
            ? '-'
            : `${bucket.total_trades} trade${bucket.total_trades === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Metric
          label="Win rate"
          value={empty ? '-' : `${Math.round(bucket.win_rate * 100)}%`}
        />
        <Metric label="Avg R" value={empty ? '-' : formatRr(bucket.avg_r)} />
        <Metric
          label="PnL"
          value={empty ? '-' : formatGbp(bucket.total_pnl_gbp)}
          tone={
            empty
              ? 'neutral'
              : bucket.total_pnl_gbp > 0
                ? 'positive'
                : bucket.total_pnl_gbp < 0
                  ? 'negative'
                  : 'neutral'
          }
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-white/35">
          Win rate
        </span>
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className={twMerge(
              'absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out',
              barColour,
            )}
            style={{
              width: empty ? '0%' : `${Math.min(100, bucket.win_rate * 100)}%`,
              opacity: 0.85,
            }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-white/35">
          PnL share
        </span>
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className={twMerge(
              'absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out',
              barColour,
            )}
            style={{
              width: `${contributionPct}%`,
              opacity: 0.6,
            }}
          />
        </div>
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'positive' | 'negative' | 'neutral'
}) {
  const colour =
    tone === 'positive'
      ? 'text-positive'
      : tone === 'negative'
        ? 'text-negative'
        : 'text-white/85'
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-white/40">
        {label}
      </span>
      <span className={twMerge('font-mono text-sm tabular-nums', colour)}>
        {value}
      </span>
    </div>
  )
}

export function PerformanceByDirectionChart({
  data,
}: PerformanceByDirectionChartProps) {
  const { long, short } = data
  const longPnl = long.total_pnl_gbp
  const shortPnl = short.total_pnl_gbp
  const totalAbs = Math.abs(longPnl) + Math.abs(shortPnl)
  const longShare = totalAbs > 0 ? (Math.abs(longPnl) / totalAbs) * 100 : 0
  const shortShare = totalAbs > 0 ? (Math.abs(shortPnl) / totalAbs) * 100 : 0

  const summary = (() => {
    if (long.total_trades === 0 && short.total_trades === 0) {
      return 'No trades match these filters'
    }
    const diff = longPnl - shortPnl
    if (Math.abs(diff) < 0.5) {
      return 'Long and short PnL are roughly even'
    }
    const winner = diff > 0 ? 'long' : 'short'
    return `Your ${winner} trades have outperformed ${winner === 'long' ? 'shorts' : 'longs'} by ${formatGbp(Math.abs(diff))}`
  })()

  return (
    <div className="flex flex-col gap-3 px-1">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <DirectionCard side="long" bucket={long} contributionPct={longShare} />
        <DirectionCard
          side="short"
          bucket={short}
          contributionPct={shortShare}
        />
      </div>
      <p className="px-1 font-mono text-[11px] tabular-nums text-white/55">
        {summary}
      </p>
    </div>
  )
}
