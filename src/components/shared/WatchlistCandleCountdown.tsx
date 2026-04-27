'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const TICK_MS = 1_000
const REFRESH_DELAY_MS = 5_000

/**
 * Computes the milliseconds remaining until the next 1h candle close.
 * Hyperliquid's 1h candles align to the wall-clock hour in UTC.
 */
function msToNextHour(now: number): number {
  const date = new Date(now)
  const next = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours() + 1,
      0,
      0,
      0,
    ),
  )
  return Math.max(0, next.getTime() - now)
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * Shows a live MM:SS countdown until the next 1h candle close. When
 * the countdown reaches zero, waits 5 seconds (so the scanner can
 * tick) and then asks Next to revalidate the page so the framework
 * readiness chips reflect the freshly-closed candle.
 */
export function WatchlistCandleCountdown() {
  const router = useRouter()
  const [now, setNow] = useState<number>(() => Date.now())
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    const remaining = msToNextHour(Date.now())
    const timer = setTimeout(() => {
      if (cancelled) return
      setRefreshing(true)
      setTimeout(() => {
        if (cancelled) return
        router.refresh()
        setRefreshing(false)
      }, REFRESH_DELAY_MS)
    }, remaining + 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const remaining = msToNextHour(now)
  return (
    <span
      className="inline-flex items-center gap-2 rounded-md border border-white/[0.06] bg-surface px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-white/55"
      title="Next 1h candle close (UTC)"
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
        style={{ filter: 'drop-shadow(0 0 4px rgba(59,130,255,0.7))' }}
      />
      {refreshing
        ? 'Refreshing…'
        : `Next 1h candle in ${formatCountdown(remaining)}`}
    </span>
  )
}
