'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { twMerge } from 'tailwind-merge'

import { StatusDot } from '@/components/ui/StatusDot'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'

type Alert = Database['public']['Tables']['alerts']['Row']
type Trade = Database['public']['Tables']['trades']['Row']

const FRAMEWORK_LABELS: Record<string, string> = {
  liquidation_hunt_v1: 'Liquidation hunt',
}

const MAX_VISIBLE = 3
const AUTO_DISMISS_MS = 8_000

type Toast =
  | {
      kind: 'alert'
      id: string
      frameworkLabel: string
      symbol: string
      direction: 'long' | 'short' | null
      isWatchlist: boolean
    }
  | {
      kind: 'close'
      id: string
      symbol: string
      direction: 'long' | 'short'
      pnl: number | null
      outcome: 'win' | 'loss' | 'breakeven'
    }

export function AlertToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  )

  useEffect(() => {
    const client = createClient()
    const timers = timersRef.current

    function pushToast(toast: Toast) {
      setToasts((current) => {
        if (current.some((t) => t.id === toast.id)) return current
        return [...current, toast].slice(-MAX_VISIBLE)
      })
      const timer = setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS)
      timers.set(toast.id, timer)
    }

    const alertsChannel = client
      .channel('alerts-toast')
      .on<Alert>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'alerts' },
        (event) => {
          const alert = event.new as Alert
          pushToast({
            kind: 'alert',
            id: alert.id,
            frameworkLabel:
              FRAMEWORK_LABELS[alert.framework_id] ?? alert.framework_id,
            symbol: alert.symbol,
            direction: alert.suggested_direction,
            isWatchlist: alert.is_watchlist,
          })
        },
      )
      .subscribe()

    // Auto-close events: scanner flips live_status from 'live' to
    // 'closed_auto' when it detects the position has left the
    // exchange. RLS scopes this to the user's tenant.
    const tradesChannel = client
      .channel('trades-close-toast')
      .on<Trade>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'trades' },
        (event) => {
          const before = event.old as Partial<Trade> | undefined
          const after = event.new as Trade
          if (
            after.live_status !== 'closed_auto' ||
            before?.live_status === 'closed_auto'
          ) {
            return
          }
          pushToast({
            kind: 'close',
            id: `close-${after.id}`,
            symbol: after.asset_symbol,
            direction: after.direction,
            pnl: after.pnl ?? null,
            outcome:
              after.outcome === 'win' ||
              after.outcome === 'loss' ||
              after.outcome === 'breakeven'
                ? after.outcome
                : 'breakeven',
          })
        },
      )
      .subscribe()

    return () => {
      void client.removeChannel(alertsChannel)
      void client.removeChannel(tradesChannel)
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function dismiss(id: string) {
    const timer = timersRef.current.get(id)
    if (timer) clearTimeout(timer)
    timersRef.current.delete(id)
    setToasts((current) => current.filter((t) => t.id !== id))
  }

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[55] flex w-[320px] flex-col gap-2">
      {toasts.map((toast) =>
        toast.kind === 'alert' ? (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 rounded-lg border border-white/[0.06] bg-surface bg-panel-lit p-3 shadow-xl"
          >
            <div className="pt-1">
              <StatusDot
                tone={toast.isWatchlist ? 'accent' : 'positive'}
                pulse
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-white/55">
                <span>{toast.frameworkLabel}</span>
                {toast.isWatchlist ? (
                  <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] tracking-wider text-accent">
                    Watchlist
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">
                  {toast.symbol}
                </span>
                {toast.direction ? (
                  <span
                    className={twMerge(
                      'rounded px-1.5 py-0.5 text-[10px] font-medium',
                      toast.direction === 'long'
                        ? 'bg-positive/15 text-positive'
                        : 'bg-negative/15 text-negative',
                    )}
                  >
                    {toast.direction === 'long' ? 'Long' : 'Short'}
                  </span>
                ) : null}
              </div>
              <Link
                href="/alerts"
                onClick={() => dismiss(toast.id)}
                className="text-xs text-accent transition-colors duration-200 hover:text-accent/80"
              >
                View alert
              </Link>
            </div>
            <DismissButton onDismiss={() => dismiss(toast.id)} />
          </div>
        ) : (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 rounded-lg border border-white/[0.06] bg-surface bg-panel-lit p-3 shadow-xl"
          >
            <div className="pt-1">
              <StatusDot
                tone={toast.outcome === 'win' ? 'positive' : 'negative'}
                pulse
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-white/55">
                Trade closed
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">
                  {toast.symbol}
                </span>
                <span
                  className={twMerge(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium',
                    toast.direction === 'long'
                      ? 'bg-positive/15 text-positive'
                      : 'bg-negative/15 text-negative',
                  )}
                >
                  {toast.direction === 'long' ? 'Long' : 'Short'}
                </span>
                <span
                  className={twMerge(
                    'text-xs font-medium tabular-nums',
                    toast.outcome === 'win'
                      ? 'text-positive'
                      : toast.outcome === 'loss'
                        ? 'text-negative'
                        : 'text-white/55',
                  )}
                >
                  {toast.pnl == null
                    ? '—'
                    : `${toast.pnl >= 0 ? '+' : ''}${toast.pnl.toFixed(2)}`}
                </span>
              </div>
              <Link
                href="/journal"
                onClick={() => dismiss(toast.id)}
                className="text-xs text-accent transition-colors duration-200 hover:text-accent/80"
              >
                View in journal
              </Link>
            </div>
            <DismissButton onDismiss={() => dismiss(toast.id)} />
          </div>
        ),
      )}
    </div>
  )
}

function DismissButton({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Dismiss toast"
      className="text-white/45 transition-colors duration-200 hover:text-white"
    >
      <svg viewBox="0 0 12 12" className="h-3 w-3">
        <path
          d="M2 2 L10 10 M10 2 L2 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </button>
  )
}
