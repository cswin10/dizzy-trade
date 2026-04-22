'use client'

import { useFormState, useFormStatus } from 'react-dom'

import { twMerge } from 'tailwind-merge'

import { dismissAlertAction } from '@/app/actions/alerts'
import type { TradeActionState } from '@/app/actions/trade-types'
import { initialTradeActionState } from '@/app/actions/trade-types'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { StatusDot } from '@/components/ui/StatusDot'
import type { Database } from '@/types/database'

import { useLogTradePanel } from './LogTradePanelContext'

export type AlertRow = Database['public']['Tables']['alerts']['Row']

export type AlertsListProps = {
  alerts: AlertRow[]
}

const FRAMEWORK_LABELS: Record<string, string> = {
  liquidation_hunt_v1: 'Liquidation hunt',
}

const FRAMEWORK_SETUP_HINT: Record<string, string> = {
  liquidation_hunt_v1: 'Liquidation hunt',
}

const relativeFormatter = new Intl.RelativeTimeFormat('en-GB', {
  numeric: 'auto',
})

function relative(iso: string): string {
  const diffMs = Date.parse(iso) - Date.now()
  const abs = Math.abs(diffMs)
  if (abs < 60_000)
    return relativeFormatter.format(Math.round(diffMs / 1_000), 'second')
  if (abs < 3_600_000)
    return relativeFormatter.format(Math.round(diffMs / 60_000), 'minute')
  if (abs < 86_400_000)
    return relativeFormatter.format(Math.round(diffMs / 3_600_000), 'hour')
  return relativeFormatter.format(Math.round(diffMs / 86_400_000), 'day')
}

function priceFormat(value: number | null): string {
  if (value === null || value === undefined) return '-'
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })
}

function diffPct(from: number | null, to: number | null): string | null {
  if (
    from === null ||
    from === undefined ||
    !Number.isFinite(from) ||
    from === 0
  )
    return null
  if (to === null || to === undefined || !Number.isFinite(to)) return null
  return `${((Math.abs(to - from) / from) * 100).toFixed(2)}%`
}

function DirectionBadge({ direction }: { direction: 'long' | 'short' | null }) {
  if (!direction) return null
  return (
    <span
      className={twMerge(
        'rounded px-2 py-0.5 text-[11px] font-medium',
        direction === 'long'
          ? 'bg-positive/15 text-positive'
          : 'bg-negative/15 text-negative',
      )}
    >
      {direction === 'long' ? 'Long' : 'Short'}
    </span>
  )
}

function Chip({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'accent' | 'muted'
}) {
  return (
    <span
      className={twMerge(
        'inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-surface-2 px-2 py-0.5 text-[11px]',
        tone === 'accent' ? 'text-accent' : 'text-white/70',
      )}
    >
      <span className="text-white/45">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  )
}

function DismissSubmit() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant="ghost"
      disabled={pending}
      className="w-auto px-3 text-xs"
    >
      {pending ? 'Dismissing' : 'Dismiss'}
    </Button>
  )
}

function AlertCard({ alert }: { alert: AlertRow }) {
  const { open: openPanel } = useLogTradePanel()
  const [dismissState, dismissAction] = useFormState<
    TradeActionState,
    FormData
  >(dismissAlertAction, initialTradeActionState)

  const frameworkLabel =
    FRAMEWORK_LABELS[alert.framework_id] ?? alert.framework_id
  const conditions = alert.condition_values as Record<string, unknown>
  const fundingVal = toNumber(conditions.funding)
  const oiDeltaPct = toNumber(conditions.oiDeltaPct)
  const wickRatio = toNumber(conditions.wickRatio)

  const stopPct = diffPct(alert.suggested_entry, alert.suggested_stop)
  const targetPct = diffPct(alert.suggested_entry, alert.suggested_target)

  const alreadyTraded = Boolean(alert.trade_id)

  return (
    <Panel
      className={twMerge(
        alert.dismissed && 'opacity-60',
        alert.is_watchlist && 'border-accent/25',
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-white/55">
              <span>{frameworkLabel}</span>
              {alert.is_watchlist ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-accent/15 px-2 py-0.5 text-[10px] tracking-wider text-accent">
                  <StatusDot tone="accent" />
                  <span>Watchlist</span>
                </span>
              ) : null}
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-medium tracking-tight text-white">
                {alert.symbol}
              </span>
              <span className="text-xs text-white/45">
                {relative(alert.triggered_at)}
              </span>
            </div>
          </div>
          <DirectionBadge direction={alert.suggested_direction} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KeyValue label="Entry" value={priceFormat(alert.suggested_entry)} />
          <KeyValue
            label="Stop"
            value={`${priceFormat(alert.suggested_stop)}${stopPct ? ` · ${stopPct}` : ''}`}
            tone="negative"
          />
          <KeyValue
            label="Target"
            value={`${priceFormat(alert.suggested_target)}${targetPct ? ` · ${targetPct}` : ''}`}
            tone="positive"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {Number.isFinite(fundingVal) ? (
            <Chip
              label="Funding"
              value={`${fundingVal >= 0 ? '+' : ''}${(fundingVal * 100).toFixed(3)}%`}
              tone="accent"
            />
          ) : null}
          {Number.isFinite(oiDeltaPct) && oiDeltaPct !== 0 ? (
            <Chip
              label="OI"
              value={`${oiDeltaPct >= 0 ? '+' : ''}${oiDeltaPct.toFixed(0)}% vs 24h`}
              tone="accent"
            />
          ) : null}
          {Number.isFinite(wickRatio) && wickRatio > 0 ? (
            <Chip label="Wick" value={`${wickRatio.toFixed(1)}x body`} />
          ) : null}
        </div>

        {dismissState.status === 'error' ? (
          <p className="text-xs text-negative">{dismissState.message}</p>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-3">
          {alreadyTraded ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-white/55">
              <StatusDot tone="positive" />
              <span>Logged as trade</span>
            </span>
          ) : null}
          {alert.dismissed ? (
            <span className="text-xs text-white/45">Dismissed</span>
          ) : (
            <form action={dismissAction}>
              <input type="hidden" name="alert_id" value={alert.id} />
              <DismissSubmit />
            </form>
          )}
          {!alreadyTraded ? (
            <Button
              type="button"
              onClick={() =>
                openPanel({
                  mode: 'create',
                  alert_id: alert.id,
                  asset_symbol: alert.symbol,
                  coingecko_id: alert.coingecko_id ?? undefined,
                  direction: alert.suggested_direction ?? undefined,
                  entry_price: alert.suggested_entry ?? undefined,
                  suggested_stop: alert.suggested_stop ?? undefined,
                  suggested_target: alert.suggested_target ?? undefined,
                  setup_type: FRAMEWORK_SETUP_HINT[alert.framework_id],
                  thesis: formatThesis(alert, frameworkLabel),
                })
              }
              className="w-auto px-4"
            >
              Open trade from alert
            </Button>
          ) : null}
        </div>
      </div>
    </Panel>
  )
}

function KeyValue({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'positive' | 'negative'
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-white/45">
        {label}
      </span>
      <span
        className={twMerge(
          'font-medium tabular-nums',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-negative',
          !tone && 'text-white/90',
        )}
      >
        {value}
      </span>
    </div>
  )
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : NaN
  }
  return NaN
}

function formatThesis(alert: AlertRow, frameworkLabel: string): string {
  const conditions = alert.condition_values as Record<string, unknown>
  const funding = toNumber(conditions.funding)
  const oi = toNumber(conditions.oiDeltaPct)
  const fundingText = Number.isFinite(funding)
    ? `Funding ${funding >= 0 ? '+' : ''}${(funding * 100).toFixed(3)}%`
    : ''
  const oiText =
    Number.isFinite(oi) && oi !== 0
      ? `OI ${oi >= 0 ? '+' : ''}${oi.toFixed(0)}% vs 24h avg`
      : ''
  const parts = [fundingText, oiText].filter(Boolean).join(', ')
  return `Alert from ${frameworkLabel} framework on ${alert.symbol}.${parts ? ' ' + parts + '.' : ''}`
}

export function AlertsList({ alerts }: AlertsListProps) {
  if (alerts.length === 0) {
    return (
      <Panel>
        <p className="py-10 text-center text-sm text-white/45">
          No alerts yet. The scanner runs every minute.
        </p>
      </Panel>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {alerts.map((alert) => (
        <AlertCard key={alert.id} alert={alert} />
      ))}
    </div>
  )
}
