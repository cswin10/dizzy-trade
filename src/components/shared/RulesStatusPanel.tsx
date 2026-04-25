'use client'

import { useCallback, useEffect, useState } from 'react'

import { twMerge } from 'tailwind-merge'

import { Panel } from '@/components/ui/Panel'
import { createClient } from '@/lib/supabase/client'
import { subscribeToTrades } from '@/lib/supabase/realtime'

const REFRESH_INTERVAL_MS = 10_000
const COOLDOWN_MS = 24 * 60 * 60 * 1000

export type RulesLiveState = {
  open_positions_count: number
  today_realised_pnl_gbp: number
  consecutive_losers_count: number
  last_loss_at: string | null
}

export type RulesLimits = {
  max_concurrent_positions: number
  max_daily_loss_gbp: number | null
  max_consecutive_losers: number | null
}

export type RulesStatusPanelProps = {
  tenantId: string
  initial: RulesLiveState
  limits: RulesLimits
}

function startOfTodayUtcIso(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

async function fetchRulesState(tenantId: string): Promise<RulesLiveState> {
  const client = createClient()
  const [openRes, pnlRes, lastLossRes, recentRes] = await Promise.all([
    client
      .from('trades')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('outcome', 'open'),
    client
      .from('trades')
      .select('pnl')
      .eq('tenant_id', tenantId)
      .in('outcome', ['win', 'loss', 'breakeven'])
      .gte('exit_at', startOfTodayUtcIso()),
    client
      .from('trades')
      .select('exit_at')
      .eq('tenant_id', tenantId)
      .eq('outcome', 'loss')
      .order('exit_at', { ascending: false })
      .limit(1),
    client
      .from('trades')
      .select('outcome, exit_at')
      .eq('tenant_id', tenantId)
      .in('outcome', ['win', 'loss', 'breakeven'])
      .order('exit_at', { ascending: false })
      .limit(20),
  ])

  let today_realised_pnl_gbp = 0
  for (const row of pnlRes.data ?? []) {
    const pnl = row.pnl
    if (typeof pnl === 'number' && Number.isFinite(pnl)) {
      today_realised_pnl_gbp += pnl
    }
  }

  let consecutive_losers_count = 0
  for (const row of recentRes.data ?? []) {
    if (row.outcome === 'loss') consecutive_losers_count++
    else break
  }

  return {
    open_positions_count: openRes.count ?? 0,
    today_realised_pnl_gbp,
    consecutive_losers_count,
    last_loss_at: lastLossRes.data?.[0]?.exit_at ?? null,
  }
}

// Maps a "current" value relative to its limit into a tone the metric
// is rendered in. Below 60% is comfortable, 60-90% approaching, above
// is at or over the cap.
function toneForUsage(
  used: number,
  limit: number,
): 'positive' | 'warning' | 'negative' {
  if (limit <= 0) return 'positive'
  const ratio = used / limit
  if (ratio < 0.6) return 'positive'
  if (ratio < 0.9) return 'warning'
  return 'negative'
}

const TONE_COLOURS: Record<'positive' | 'warning' | 'negative', string> = {
  positive: 'text-positive',
  warning: 'text-warning',
  negative: 'text-negative',
}

export function RulesStatusPanel({
  tenantId,
  initial,
  limits,
}: RulesStatusPanelProps) {
  const [state, setState] = useState<RulesLiveState>(initial)

  const refresh = useCallback(async () => {
    try {
      const next = await fetchRulesState(tenantId)
      setState(next)
    } catch (error) {
      console.warn('[rules] refresh failed', error)
    }
  }, [tenantId])

  useEffect(() => {
    const client = createClient()
    const channel = subscribeToTrades(client, tenantId, () => {
      void refresh()
    })
    const timer = setInterval(() => {
      void refresh()
    }, REFRESH_INTERVAL_MS)
    return () => {
      clearInterval(timer)
      void client.removeChannel(channel)
    }
  }, [tenantId, refresh])

  const openTone = toneForUsage(
    state.open_positions_count,
    limits.max_concurrent_positions,
  )

  const lossUsed = Math.max(0, -state.today_realised_pnl_gbp)
  const lossTone =
    limits.max_daily_loss_gbp == null
      ? 'positive'
      : toneForUsage(lossUsed, limits.max_daily_loss_gbp)

  const losersTone =
    limits.max_consecutive_losers == null
      ? 'positive'
      : toneForUsage(
          state.consecutive_losers_count,
          limits.max_consecutive_losers,
        )

  const lastLossMs = state.last_loss_at ? Date.parse(state.last_loss_at) : null
  const cooldownActive =
    limits.max_consecutive_losers != null &&
    state.consecutive_losers_count >= limits.max_consecutive_losers &&
    lastLossMs !== null &&
    Date.now() - lastLossMs < COOLDOWN_MS
  const cooldownRemainingHours =
    cooldownActive && lastLossMs !== null
      ? Math.max(
          0,
          24 - Math.floor((Date.now() - lastLossMs) / (60 * 60 * 1000)),
        )
      : 0

  return (
    <Panel title="Live status">
      <div className="flex flex-col gap-4">
        <Metric
          label="Open positions"
          value={`${state.open_positions_count} / ${limits.max_concurrent_positions}`}
          tone={openTone}
        />
        <Metric
          label="Today's PnL"
          value={`${formatPnl(state.today_realised_pnl_gbp)}${
            limits.max_daily_loss_gbp != null
              ? ` (cap -£${limits.max_daily_loss_gbp.toFixed(0)})`
              : ''
          }`}
          tone={lossTone}
        />
        <Metric
          label="Consecutive losers"
          value={
            limits.max_consecutive_losers != null
              ? `${state.consecutive_losers_count} / ${limits.max_consecutive_losers}`
              : `${state.consecutive_losers_count}`
          }
          tone={losersTone}
        />
        <Metric
          label="Cool-down"
          value={
            cooldownActive
              ? `Active · ${cooldownRemainingHours} hour${cooldownRemainingHours === 1 ? '' : 's'} left`
              : 'No'
          }
          tone={cooldownActive ? 'negative' : 'positive'}
        />
      </div>
    </Panel>
  )
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'positive' | 'warning' | 'negative'
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] font-medium uppercase tracking-wider text-white/45">
        {label}
      </span>
      <span
        className={twMerge(
          'text-lg font-medium tabular-nums',
          TONE_COLOURS[tone],
        )}
      >
        {value}
      </span>
    </div>
  )
}

function formatPnl(value: number): string {
  if (value === 0) return '£0'
  const abs = Math.abs(value)
  return value > 0 ? `+£${abs.toFixed(2)}` : `-£${abs.toFixed(2)}`
}
