'use client'

import { twMerge } from 'tailwind-merge'

import type { PerformanceByBtcContext } from '@/app/actions/analytics'

export type PerformanceByBtcContextChartProps = {
  data: PerformanceByBtcContext
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

type ContextKey = 'up' | 'ranging' | 'down'

const LABELS: Record<ContextKey, string> = {
  up: 'BTC trending up',
  ranging: 'BTC ranging',
  down: 'BTC trending down',
}

const ACCENTS: Record<ContextKey, string> = {
  up: 'border-positive/25',
  ranging: 'border-white/10',
  down: 'border-negative/25',
}

const DOT_COLOURS: Record<ContextKey, string> = {
  up: 'bg-positive',
  ranging: 'bg-white/40',
  down: 'bg-negative',
}

function ContextCard({
  contextKey,
  bucket,
}: {
  contextKey: ContextKey
  bucket: PerformanceByBtcContext['up']
}) {
  const empty = bucket.total_trades === 0
  return (
    <div
      className={twMerge(
        'flex flex-col gap-3 rounded-lg border bg-surface bg-panel-lit p-4',
        ACCENTS[contextKey],
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-white/55">
          <span
            aria-hidden
            className={twMerge(
              'h-1.5 w-1.5 rounded-full',
              DOT_COLOURS[contextKey],
            )}
          />
          <span>{LABELS[contextKey]}</span>
        </span>
        <span className="font-mono text-[11px] tabular-nums text-white/55">
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

export function PerformanceByBtcContextChart({
  data,
}: PerformanceByBtcContextChartProps) {
  const totalKnown =
    data.up.total_trades + data.ranging.total_trades + data.down.total_trades
  if (totalKnown === 0 && data.unknown_count === 0) {
    return (
      <div className="flex h-[160px] items-center justify-center">
        <p className="font-mono text-[11px] uppercase tracking-widest text-white/35">
          No trades match these filters
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3 px-1">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ContextCard contextKey="up" bucket={data.up} />
        <ContextCard contextKey="ranging" bucket={data.ranging} />
        <ContextCard contextKey="down" bucket={data.down} />
      </div>
      {data.unknown_count > 0 ? (
        <p className="px-1 font-mono text-[11px] tabular-nums text-white/45">
          {data.unknown_count} trade{data.unknown_count === 1 ? '' : 's'} have
          no BTC context recorded (logged before this feature)
        </p>
      ) : null}
    </div>
  )
}
