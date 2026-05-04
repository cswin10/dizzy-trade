'use client'

// Client-side shell for /live. Renders aggregate stats, the kill
// switch, the pending-signals queue, the active deployments list,
// and a mock-only debug pane. All mutations go through server
// actions; the page is a server component that fetches and
// hands data down as props.

import Link from 'next/link'
import { useState, useTransition } from 'react'

import { twMerge } from 'tailwind-merge'

import {
  killAllAction,
  pauseDeploymentAction,
} from '@/app/actions/live-deployments'
import {
  confirmSignalAction,
  fireTestSignalAction,
  forceFillEntryAction,
  forceTriggerStopAction,
  forceTriggerTargetAction,
  pushMockTickAction,
  runMonitorTickAction,
  skipSignalAction,
} from '@/app/actions/live-signals'
import { Button } from '@/components/ui/Button'

import { ConfirmDialog } from './ConfirmDialog'

type SignalRow = {
  id: string
  deployment_id: string
  pair: string
  direction: 'long' | 'short'
  signal_at: string
  intended_entry_price: number | string
  intended_stop_price: number | string
  intended_target_price: number | string
  intended_size_coin: number | string
  intended_risk_gbp: number | string
  intended_rr: number | string
  status: string
  confirmed_at: string | null
  expires_at: string | null
  filled_at: string | null
  fill_price: number | string | null
  closed_at: string | null
  exit_price: number | string | null
  exit_reason: string | null
  realised_pnl_gbp: number | string | null
  realised_r_multiple: number | string | null
  failure_reason: string | null
}

type DeploymentRow = {
  id: string
  status: 'live' | 'paused' | 'archived'
  live_pairs: string[]
  live_risk_gbp: number | string
  live_max_concurrent_positions: number
  live_order_lifetime_candles: number
  strategy_definition_id: string | null
  legacy_strategy_id: string | null
  deployed_at: string
}

export type LiveDashboardProps = {
  stats: {
    active_deployments: number
    pending_signals: number
    open_positions: number
    todays_pnl_gbp: number
    todays_signals: number
    todays_confirmations: number
    todays_fills: number
  }
  deployments: DeploymentRow[]
  signals: SignalRow[]
  auditEvents: Array<{
    at: string
    kind: string
    pair: string
    detail: string
    order_id?: string
  }>
  mockActive: boolean
}

function formatGbp(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const sign = value < 0 ? '-' : value > 0 ? '+' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    maximumFractionDigits: 0,
  })}`
}

function formatNumber(value: number | string | null | undefined, digits = 2): string {
  if (value == null) return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(digits)
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function LiveDashboard({
  stats,
  deployments,
  signals,
  auditEvents,
  mockActive,
}: LiveDashboardProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [killOpen, setKillOpen] = useState(false)

  const pending = signals.filter((s) => s.status === 'pending_confirmation')
  const recentClosed = signals.filter(
    (s) => s.status === 'closed_at_stop' || s.status === 'closed_at_target',
  )

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Active deployments" value={String(stats.active_deployments)} />
        <Stat label="Pending signals" value={String(stats.pending_signals)} />
        <Stat label="Open positions" value={String(stats.open_positions)} />
        <Stat
          label="Today's PnL"
          value={formatGbp(stats.todays_pnl_gbp)}
          tone={
            stats.todays_pnl_gbp > 0
              ? 'positive'
              : stats.todays_pnl_gbp < 0
                ? 'negative'
                : undefined
          }
        />
        <Stat label="Today's signals" value={String(stats.todays_signals)} />
        <Stat label="Confirmations" value={String(stats.todays_confirmations)} />
        <Stat label="Fills" value={String(stats.todays_fills)} />
      </section>

      <section className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-red-200">Kill switch</h2>
            <p className="text-[11px] text-white/55">
              Pauses every live deployment for this tenant and cancels every
              open exchange order. In-flight signals are marked cancelled.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="w-auto border border-red-500/40 bg-red-500/15 text-red-200 hover:bg-red-500/25"
            disabled={isPending}
            onClick={() => setKillOpen(true)}
          >
            Pause all live strategies
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/55">
          Pending signals ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-xs text-white/55">
            No signals awaiting confirmation. Fire a test signal below to
            exercise the pipeline.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pending.map((s) => (
              <PendingSignalCard
                key={s.id}
                signal={s}
                isPending={isPending}
                onConfirm={() =>
                  startTransition(async () => {
                    setError(null)
                    const r = await confirmSignalAction(s.id, 'app')
                    if (!r.ok) setError(r.message ?? 'Confirm failed')
                  })
                }
                onSkip={() =>
                  startTransition(async () => {
                    setError(null)
                    const r = await skipSignalAction(s.id, 'app')
                    if (!r.ok) setError(r.message ?? 'Skip failed')
                  })
                }
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/55">
          Active deployments ({deployments.filter((d) => d.status === 'live').length})
        </h2>
        {deployments.length === 0 ? (
          <p className="text-xs text-white/55">
            No deployments yet. Deploy a strategy from{' '}
            <Link href="/settings/strategies" className="text-accent hover:underline">
              Strategies
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {deployments.map((d) => (
              <DeploymentCard
                key={d.id}
                deployment={d}
                signals={signals.filter((s) => s.deployment_id === d.id)}
                isPending={isPending}
                onPause={() =>
                  startTransition(async () => {
                    setError(null)
                    const r = await pauseDeploymentAction(d.id)
                    if (!r.ok) setError(r.message ?? 'Pause failed')
                  })
                }
              />
            ))}
          </ul>
        )}
      </section>

      {recentClosed.length > 0 ? (
        <section className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/55">
            Recent closes
          </h2>
          <ul className="flex flex-col gap-2 text-xs">
            {recentClosed.slice(0, 10).map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/[0.06] bg-bg/40 px-3 py-2"
              >
                <span className="font-mono text-white/80">
                  {s.pair} {s.direction.toUpperCase()}
                </span>
                <span className="text-white/55">
                  exit at {formatNumber(s.exit_price, 2)} ({s.exit_reason})
                </span>
                <span
                  className={
                    Number(s.realised_pnl_gbp ?? 0) >= 0
                      ? 'text-emerald-300'
                      : 'text-red-300'
                  }
                >
                  {formatGbp(Number(s.realised_pnl_gbp ?? 0))} ·{' '}
                  {formatNumber(s.realised_r_multiple, 2)}R
                </span>
                <span className="text-white/45">{formatTime(s.closed_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {mockActive ? (
        <MockDebugPanel
          deployments={deployments}
          signals={signals}
          auditEvents={auditEvents}
          isPending={isPending}
          startTransition={startTransition}
          setError={setError}
        />
      ) : null}

      <ConfirmDialog
        open={killOpen}
        onClose={() => setKillOpen(false)}
        onConfirm={() =>
          startTransition(async () => {
            setError(null)
            setKillOpen(false)
            const r = await killAllAction()
            if (!r.ok) setError(r.message ?? 'Kill switch failed')
          })
        }
        title="Pause all live strategies?"
        message="Cancels every open exchange order and transitions every live deployment to paused. Open signals are marked cancelled."
        confirmLabel="Pause all"
        destructive
        busy={isPending}
      />
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'positive' | 'negative'
}) {
  return (
    <div className="rounded border border-white/[0.06] bg-surface p-3">
      <div className="text-[10px] uppercase tracking-wider text-white/45">
        {label}
      </div>
      <div
        className={twMerge(
          'mt-1 font-mono text-sm text-white/90',
          tone === 'positive' && 'text-emerald-300',
          tone === 'negative' && 'text-red-300',
        )}
      >
        {value}
      </div>
    </div>
  )
}

function PendingSignalCard({
  signal,
  isPending,
  onConfirm,
  onSkip,
}: {
  signal: SignalRow
  isPending: boolean
  onConfirm: () => void
  onSkip: () => void
}) {
  return (
    <li className="rounded border border-amber-500/30 bg-amber-500/[0.05] p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono font-semibold text-white">
          {signal.pair} {signal.direction.toUpperCase()}
        </span>
        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
          pending
        </span>
        <span className="ml-auto text-[11px] text-white/55">
          {formatTime(signal.signal_at)}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-white/65 sm:grid-cols-4">
        <div>
          <dt className="text-white/45">Entry</dt>
          <dd className="font-mono">{formatNumber(signal.intended_entry_price, 2)}</dd>
        </div>
        <div>
          <dt className="text-white/45">Stop</dt>
          <dd className="font-mono">{formatNumber(signal.intended_stop_price, 2)}</dd>
        </div>
        <div>
          <dt className="text-white/45">Target</dt>
          <dd className="font-mono">{formatNumber(signal.intended_target_price, 2)}</dd>
        </div>
        <div>
          <dt className="text-white/45">Size</dt>
          <dd className="font-mono">
            {formatNumber(signal.intended_size_coin, 6)} {signal.pair}
          </dd>
        </div>
        <div>
          <dt className="text-white/45">Risk</dt>
          <dd className="font-mono">{formatGbp(Number(signal.intended_risk_gbp))}</dd>
        </div>
        <div>
          <dt className="text-white/45">RR</dt>
          <dd className="font-mono">{formatNumber(signal.intended_rr, 2)}</dd>
        </div>
      </dl>
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          variant="primary"
          className="w-auto"
          disabled={isPending}
          onClick={onConfirm}
        >
          ✅ Confirm and place
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-auto"
          disabled={isPending}
          onClick={onSkip}
        >
          ❌ Skip
        </Button>
      </div>
    </li>
  )
}

function DeploymentCard({
  deployment,
  signals,
  isPending,
  onPause,
}: {
  deployment: DeploymentRow
  signals: SignalRow[]
  isPending: boolean
  onPause: () => void
}) {
  const fired = signals.length
  const confirmed = signals.filter((s) => s.confirmed_at != null).length
  const filled = signals.filter((s) => s.filled_at != null).length
  const closed = signals.filter(
    (s) => s.status === 'closed_at_stop' || s.status === 'closed_at_target',
  )
  const pnl = closed.reduce(
    (a, s) => a + Number(s.realised_pnl_gbp ?? 0),
    0,
  )
  return (
    <li className="rounded border border-white/[0.06] bg-bg/40 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono font-medium text-white">
          {deployment.legacy_strategy_id ? 'Framework' : 'Composable'} ·{' '}
          {deployment.live_pairs.join(', ')}
        </span>
        <span
          className={twMerge(
            'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
            deployment.status === 'live' && 'bg-emerald-500/15 text-emerald-300',
            deployment.status === 'paused' && 'bg-white/10 text-white/55',
            deployment.status === 'archived' && 'bg-white/5 text-white/35',
          )}
        >
          {deployment.status}
        </span>
        <Link
          href={`/live/${deployment.id}`}
          className="ml-auto text-xs text-accent hover:underline"
        >
          View detail
        </Link>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-white/65 sm:grid-cols-6">
        <Span label="Risk/trade" value={formatGbp(Number(deployment.live_risk_gbp))} />
        <Span label="Max positions" value={String(deployment.live_max_concurrent_positions)} />
        <Span label="Lifetime" value={`${deployment.live_order_lifetime_candles} cdl`} />
        <Span label="Signals" value={String(fired)} />
        <Span label="Filled" value={`${filled}/${confirmed}`} />
        <Span
          label="PnL"
          value={formatGbp(pnl)}
          tone={pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : undefined}
        />
      </div>
      {deployment.status === 'live' ? (
        <div className="mt-3">
          <Button
            type="button"
            variant="ghost"
            className="w-auto"
            disabled={isPending}
            onClick={onPause}
          >
            Pause deployment
          </Button>
        </div>
      ) : null}
    </li>
  )
}

function Span({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'positive' | 'negative'
}) {
  return (
    <div>
      <div className="text-white/45">{label}</div>
      <div
        className={twMerge(
          'font-mono text-white/85',
          tone === 'positive' && 'text-emerald-300',
          tone === 'negative' && 'text-red-300',
        )}
      >
        {value}
      </div>
    </div>
  )
}

function MockDebugPanel({
  deployments,
  signals,
  auditEvents,
  isPending,
  startTransition,
  setError,
}: {
  deployments: DeploymentRow[]
  signals: SignalRow[]
  auditEvents: LiveDashboardProps['auditEvents']
  isPending: boolean
  startTransition: React.TransitionStartFunction
  setError: (m: string | null) => void
}) {
  const liveDeployments = deployments.filter((d) => d.status === 'live')
  const [deploymentId, setDeploymentId] = useState<string>(
    liveDeployments[0]?.id ?? '',
  )
  const [pair, setPair] = useState<string>(
    liveDeployments[0]?.live_pairs[0] ?? 'BTC',
  )
  const [direction, setDirection] = useState<'long' | 'short'>('long')
  const [closePrice, setClosePrice] = useState<string>('68935')
  const [stopPrice, setStopPrice] = useState<string>('67912')
  const [targetPrice, setTargetPrice] = useState<string>('71494')

  const inFlight = signals.filter(
    (s) =>
      s.status === 'order_placed' ||
      s.status === 'filled' ||
      s.status === 'pending_confirmation',
  )

  return (
    <details className="rounded-lg border border-accent/20 bg-accent/[0.03] p-4 sm:p-5" open>
      <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-wider text-accent">
        Mock debug panel (Phase 1)
      </summary>
      <p className="mt-3 text-[11px] text-white/55">
        These controls drive the in-memory mock exchange so you can step a
        signal through its state machine without a real venue.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-white/45">
            Deployment
          </label>
          <select
            value={deploymentId}
            onChange={(e) => setDeploymentId(e.target.value)}
            className="mt-1 w-full rounded border border-white/10 bg-bg px-2 py-1 text-xs text-white"
          >
            {liveDeployments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id.slice(0, 8)} · {d.live_pairs.join(',')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-white/45">
            Pair
          </label>
          <input
            value={pair}
            onChange={(e) => setPair(e.target.value.toUpperCase())}
            className="mt-1 w-full rounded border border-white/10 bg-bg px-2 py-1 text-xs text-white"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-white/45">
            Direction
          </label>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'long' | 'short')}
            className="mt-1 w-full rounded border border-white/10 bg-bg px-2 py-1 text-xs text-white"
          >
            <option value="long">long</option>
            <option value="short">short</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-white/45">
            Close
          </label>
          <input
            value={closePrice}
            onChange={(e) => setClosePrice(e.target.value)}
            className="mt-1 w-full rounded border border-white/10 bg-bg px-2 py-1 text-xs text-white"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-white/45">
            Stop
          </label>
          <input
            value={stopPrice}
            onChange={(e) => setStopPrice(e.target.value)}
            className="mt-1 w-full rounded border border-white/10 bg-bg px-2 py-1 text-xs text-white"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-white/45">
            Target
          </label>
          <input
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
            className="mt-1 w-full rounded border border-white/10 bg-bg px-2 py-1 text-xs text-white"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          className="w-auto"
          disabled={isPending || !deploymentId}
          onClick={() =>
            startTransition(async () => {
              setError(null)
              const r = await fireTestSignalAction({
                deployment_id: deploymentId,
                pair,
                direction,
                signal_close_price: Number(closePrice),
                raw_stop_price: Number(stopPrice),
                raw_target_price: Number(targetPrice),
              })
              if (!r.ok) setError(r.message ?? 'Fire failed')
            })
          }
        >
          Fire test signal
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-auto"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setError(null)
              await runMonitorTickAction()
            })
          }
        >
          Run monitor tick
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-auto"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setError(null)
              await pushMockTickAction({
                pair,
                price: Number(closePrice),
                high: Number(closePrice) * 1.001,
                low: Number(closePrice) * 0.999,
              })
            })
          }
        >
          Push mock tick at close price
        </Button>
      </div>

      {inFlight.length > 0 ? (
        <div className="mt-4">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-white/45">
            In-flight signals
          </div>
          <ul className="space-y-1 text-xs">
            {inFlight.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/[0.06] bg-bg/40 px-3 py-2"
              >
                <span className="font-mono">
                  {s.id.slice(0, 8)} · {s.pair} {s.direction} · {s.status}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-auto"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        setError(null)
                        await forceFillEntryAction(s.id)
                      })
                    }
                  >
                    Force fill
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-auto"
                    disabled={isPending || s.status !== 'filled'}
                    onClick={() =>
                      startTransition(async () => {
                        setError(null)
                        await forceTriggerStopAction(s.id)
                      })
                    }
                  >
                    Force stop
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-auto"
                    disabled={isPending || s.status !== 'filled'}
                    onClick={() =>
                      startTransition(async () => {
                        setError(null)
                        await forceTriggerTargetAction(s.id)
                      })
                    }
                  >
                    Force target
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {auditEvents.length > 0 ? (
        <div className="mt-4">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-white/45">
            Mock audit log (drained)
          </div>
          <pre className="overflow-x-auto rounded border border-white/[0.06] bg-bg/40 p-3 text-[11px] text-white/65">
            {auditEvents
              .map(
                (e) =>
                  `${new Date(e.at).toISOString()} ${e.kind.padEnd(18)} ${e.pair.padEnd(6)} ${e.detail}`,
              )
              .join('\n')}
          </pre>
        </div>
      ) : null}
    </details>
  )
}
