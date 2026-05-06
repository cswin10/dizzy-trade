'use client'

import { useState } from 'react'

import { twMerge } from 'tailwind-merge'

import { useLivePrice } from './WatchlistPriceTicker'
import { Panel } from '@/components/ui/Panel'
import type { FrameworkChip } from '@/lib/frameworks/conditions'
import type {
  WatchlistFrameworkView,
  WatchlistPairView,
} from '@/app/actions/watchlist'

export type WatchlistPairCardProps = {
  pair: WatchlistPairView
  activeFrameworkId: string | null
}

function formatPrice(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-'
  const abs = Math.abs(value)
  let digits: number
  if (abs >= 1000) digits = 0
  else if (abs >= 100) digits = 1
  else if (abs >= 10) digits = 2
  else if (abs >= 1) digits = 3
  else if (abs >= 0.01) digits = 4
  else digits = 6
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatPct(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`
}

function formatPctRaw(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
}

function formatMillions(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-'
  if (Math.abs(value) >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`
  }
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`
  }
  return `$${value.toFixed(0)}`
}

function NarrativePill({
  heat,
  isMajor,
}: {
  heat: 'hot' | 'warm' | 'cool' | 'cold' | null
  isMajor: boolean
}) {
  if (isMajor) {
    return (
      <span className="inline-flex items-center rounded-md border border-white/15 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-white/70">
        Major
      </span>
    )
  }
  if (!heat) {
    return (
      <span className="inline-flex items-center rounded-md border border-white/10 bg-transparent px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-white/40">
        Untagged
      </span>
    )
  }
  const tone =
    heat === 'hot'
      ? 'border-negative/40 bg-negative/15 text-negative'
      : heat === 'warm'
        ? 'border-warning/40 bg-warning/15 text-warning'
        : heat === 'cool'
          ? 'border-accent/40 bg-accent/15 text-accent'
          : 'border-white/15 bg-white/[0.04] text-white/55'
  return (
    <span
      className={twMerge(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest',
        tone,
      )}
    >
      {heat}
    </span>
  )
}

function ChangeBadge({ value }: { value: number | null }) {
  if (value == null || !Number.isFinite(value)) {
    return (
      <span className="font-mono text-xs tabular-nums text-white/45">-</span>
    )
  }
  const positive = value > 0
  const negative = value < 0
  const arrow = positive ? '▲' : negative ? '▼' : '•'
  const tone = positive
    ? 'text-positive [text-shadow:0_0_10px_rgba(74,222,128,0.4)]'
    : negative
      ? 'text-negative [text-shadow:0_0_10px_rgba(248,113,113,0.4)]'
      : 'text-white/55'
  return (
    <span
      className={twMerge(
        'inline-flex items-center gap-1 font-mono text-sm font-medium tabular-nums',
        tone,
      )}
    >
      <span aria-hidden className="text-[10px]">
        {arrow}
      </span>
      <span>{formatPct(value, 2)}</span>
    </span>
  )
}

function ChipPill({ chip }: { chip: FrameworkChip }) {
  return (
    <span
      title={chip.tooltip}
      className={twMerge(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider',
        chip.passed
          ? 'border-positive/35 bg-positive/10 text-positive'
          : 'border-negative/30 bg-negative/[0.07] text-negative/85',
      )}
    >
      <span className="text-white/55">{chip.label}</span>
      <span className="tabular-nums text-white/85">{chip.value}</span>
    </span>
  )
}

function FrameworkBlock({
  view,
  isActive,
}: {
  view: WatchlistFrameworkView
  isActive: boolean
}) {
  const { breakdown } = view
  const pct =
    breakdown.totalCount === 0
      ? 0
      : Math.round((breakdown.metCount / breakdown.totalCount) * 100)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-white/55">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-accent"
            style={{ filter: 'drop-shadow(0 0 4px rgba(59,130,255,0.6))' }}
          />
          {view.name}
          {isActive ? (
            <span className="rounded bg-accent/15 px-1 py-0.5 text-[9px] tracking-widest text-accent">
              Active
            </span>
          ) : null}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-white/45">
          {breakdown.metCount}/{breakdown.totalCount}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {breakdown.chips.map((chip) => (
          <ChipPill key={chip.label} chip={chip} />
        ))}
      </div>
      {breakdown.wouldTrigger ? (
        <p
          className="font-mono text-[10px] uppercase tracking-widest text-positive"
          style={{ textShadow: '0 0 10px rgba(74,222,128,0.5)' }}
        >
          ● Ready · alert firing this candle
        </p>
      ) : (
        <div className="relative h-px w-full overflow-hidden bg-white/[0.06]">
          <div
            className={twMerge(
              'absolute inset-y-0 left-0 transition-[width] duration-500 ease-out',
              pct >= 80
                ? 'bg-positive'
                : pct >= 60
                  ? 'bg-warning'
                  : 'bg-accent',
            )}
            style={{
              width: `${pct}%`,
              filter: 'drop-shadow(0 0 4px rgba(59,130,255,0.55))',
            }}
          />
        </div>
      )}
    </div>
  )
}

function MarketStat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'positive' | 'negative' | 'neutral'
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-positive'
      : tone === 'negative'
        ? 'text-negative'
        : 'text-white/85'
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-widest text-white/40">
        {label}
      </span>
      <span
        className={twMerge(
          'font-mono text-xs font-medium tabular-nums',
          toneClass,
        )}
      >
        {value}
      </span>
    </div>
  )
}

function MiniSpark({ values }: { values: number[] }) {
  if (values.length < 2) return null
  let min = values[0]!
  let max = values[0]!
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const range = max - min || 1
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100
      const y = 100 - ((v - min) / range) * 100
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  const last = values[values.length - 1]!
  const first = values[0]!
  const positive = last >= first
  const stroke = positive ? '#4ADE80' : '#F87171'
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
      className="h-12 w-full"
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 3px ${stroke}55)` }}
      />
    </svg>
  )
}

export function WatchlistPairCard({
  pair,
  activeFrameworkId,
}: WatchlistPairCardProps) {
  const [expanded, setExpanded] = useState(false)
  const live = useLivePrice(pair.symbol)
  const livePrice = live?.price ?? pair.price
  const liveVolume = live?.volume_24h ?? pair.context.volume_24h

  // Border escalation by best framework readiness across this pair.
  const borderTone = (() => {
    if (pair.any_firing) {
      return 'border-positive/55 shadow-[0_0_24px_rgba(74,222,128,0.18)]'
    }
    const top = pair.frameworks.reduce((acc, f) => {
      if (f.breakdown.totalCount === 0) return acc
      const r = f.breakdown.metCount / f.breakdown.totalCount
      return r > acc ? r : acc
    }, 0)
    if (top >= 0.66) {
      return 'border-warning/45 shadow-[0_0_18px_rgba(245,158,11,0.18)]'
    }
    return 'border-white/10'
  })()

  const distanceTone = (() => {
    const value = pair.context.sma_distance_pct
    if (value == null) return 'neutral' as const
    if (value > 0.5) return 'positive' as const
    if (value < -0.5) return 'negative' as const
    return 'neutral' as const
  })()

  const fundingTone = (() => {
    const value = pair.context.funding
    if (value == null) return 'neutral' as const
    if (value > 0.0001) return 'positive' as const
    if (value < -0.0001) return 'negative' as const
    return 'neutral' as const
  })()

  return (
    <Panel
      className={twMerge(
        'transition-colors duration-200 hover:border-white/25',
        borderTone,
      )}
      bodyClassName="px-3 py-3 sm:px-4 sm:py-4"
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,180px)_minmax(0,1fr)_minmax(0,220px)]">
        {/* Symbol + price */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-col items-start gap-1.5 text-left"
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-2">
            <span className="text-xl font-medium tracking-tight text-white">
              {pair.symbol}
            </span>
            <NarrativePill heat={pair.narrative_heat} isMajor={pair.is_major} />
          </div>
          <div className="flex flex-col gap-0.5">
            <span
              className="font-mono text-2xl font-medium tabular-nums text-white"
              style={{ textShadow: '0 0 16px rgba(59,130,255,0.18)' }}
            >
              {formatPrice(livePrice)}
            </span>
            <ChangeBadge value={pair.change_24h_pct} />
          </div>
        </button>

        {/* Framework readiness */}
        <div className="flex min-w-0 flex-col gap-3">
          {pair.has_data ? (
            pair.frameworks.length > 0 ? (
              pair.frameworks.map((view) => (
                <FrameworkBlock
                  key={view.id}
                  view={view}
                  isActive={view.id === activeFrameworkId}
                />
              ))
            ) : (
              <p className="font-mono text-[11px] uppercase tracking-widest text-white/35">
                No frameworks evaluated · check thresholds
              </p>
            )
          ) : (
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-warning">
              <span
                aria-hidden
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning"
              />
              Waiting for data · 1m
            </span>
          )}
        </div>

        {/* Market context */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
          <MarketStat
            label="Funding"
            value={formatPct(pair.context.funding, 4)}
            tone={fundingTone}
          />
          <MarketStat
            label="OI"
            value={formatMillions(pair.context.open_interest)}
          />
          <MarketStat label="Vol 24h" value={formatMillions(liveVolume)} />
          <MarketStat
            label="RSI(14)"
            value={
              pair.context.rsi14 == null ? '-' : pair.context.rsi14.toFixed(1)
            }
          />
          <MarketStat
            label="vs SMA20"
            value={formatPctRaw(pair.context.sma_distance_pct, 2)}
            tone={distanceTone}
          />
        </div>
      </div>

      {expanded ? (
        <div
          className="mt-4 grid grid-cols-1 gap-3 border-t border-white/[0.04] pt-3 lg:grid-cols-[180px_1fr]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-white/40">
              Last 20 · 1h
            </span>
            <MiniSpark values={pair.spark} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-white/40">
              All frameworks
            </span>
            <div className="flex flex-col gap-3">
              {pair.frameworks.length === 0 ? (
                <p className="text-xs text-white/45">
                  No framework evaluations available for this pair yet.
                </p>
              ) : (
                pair.frameworks.map((view) => (
                  <FrameworkBlock
                    key={`${view.id}-expanded`}
                    view={view}
                    isActive={view.id === activeFrameworkId}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Panel>
  )
}
