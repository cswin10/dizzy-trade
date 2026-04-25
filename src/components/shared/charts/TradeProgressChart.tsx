'use client'

import { useEffect, useState } from 'react'

const TRADES_GOAL = 50

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
})

export type TradeProgressChartProps = {
  total_trades: number
  // Days between the first and most recent closed trade. The
  // estimator uses this to project completion at the current pace.
  trade_span_days: number | null
}

function estimateCompletion(
  total: number,
  spanDays: number | null,
): Date | null {
  if (total < 5) return null
  if (spanDays == null || spanDays <= 0) return null
  if (total >= TRADES_GOAL) return null
  const tradesPerDay = total / spanDays
  if (tradesPerDay <= 0) return null
  const tradesLeft = TRADES_GOAL - total
  const daysLeft = tradesLeft / tradesPerDay
  return new Date(Date.now() + daysLeft * 24 * 60 * 60 * 1000)
}

export function TradeProgressChart({
  total_trades,
  trade_span_days,
}: TradeProgressChartProps) {
  const cappedTotal = Math.min(total_trades, TRADES_GOAL)
  const targetPct = (cappedTotal / TRADES_GOAL) * 100
  const remaining = Math.max(0, TRADES_GOAL - total_trades)
  const eta = estimateCompletion(total_trades, trade_span_days)

  // Animate the bar fill on mount; client-only so we start at 0 and
  // tween to the target after the first paint.
  const [animatedPct, setAnimatedPct] = useState(0)
  useEffect(() => {
    const handle = window.requestAnimationFrame(() => setAnimatedPct(targetPct))
    return () => window.cancelAnimationFrame(handle)
  }, [targetPct])

  return (
    <div className="flex flex-col gap-3 px-1 py-2">
      <span className="text-[10px] font-medium uppercase tracking-widest text-white/45">
        <span
          aria-hidden
          className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle"
          style={{ filter: 'drop-shadow(0 0 4px rgba(59,130,255,0.55))' }}
        />
        Progress toward v1
      </span>
      <div
        role="progressbar"
        aria-valuenow={total_trades}
        aria-valuemin={0}
        aria-valuemax={TRADES_GOAL}
        className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.04]"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-1000 ease-out"
          style={{
            width: `${animatedPct}%`,
            filter: 'drop-shadow(0 0 6px rgba(59,130,255,0.55))',
          }}
        />
      </div>
      <p className="font-mono text-xs tabular-nums text-white/65">
        <span className="text-white">{total_trades}</span>
        <span className="text-white/40"> of {TRADES_GOAL}</span>
        <span className="text-white/30"> · </span>
        <span>{remaining} to go</span>
        {eta ? (
          <>
            <span className="text-white/30"> · </span>
            <span>est. {dateFormatter.format(eta)}</span>
          </>
        ) : null}
      </p>
    </div>
  )
}
