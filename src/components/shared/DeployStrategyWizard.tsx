'use client'

// Single-page deploy wizard for Phase 1. Phase 2 will likely
// expand this into a 3-step flow (backtest justification ->
// config -> consent) once the realistic-edge guidance copy needs
// more space and the auto-execute path goes live; for now a single
// page with all three sections inline keeps the surface area
// shallow while the underlying server action is still settling.

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { deployStrategyAction } from '@/app/actions/live-deployments'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export type DeployStrategyWizardProps = {
  strategy: {
    id: string
    name: string
    pairs: string[]
    timeframe: string
    deployment_status: 'draft' | 'live' | 'paused' | 'archived'
  }
  // Full set of tradable symbols from the universe table. The
  // strategy's own configured pairs are pre-ticked when the
  // wizard mounts, but the operator can deselect or add others
  // before deploying. Falls back to the strategy's pairs when the
  // universe is empty so the chips always have something to
  // render.
  pairUniverse: string[]
  recentBacktests: Array<{
    id: string
    name: string
    total_trades: number | null
    win_rate: number | null
    avg_r: number | null
    total_pnl_gbp: number | null
    max_drawdown_gbp: number | null
    sharpe_ratio: number | null
    created_at: string | null
  }>
}

function formatGbp(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const sign = value < 0 ? '-' : value > 0 ? '+' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    maximumFractionDigits: 0,
  })}`
}

function formatPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

function formatNumber(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

export function DeployStrategyWizard({
  strategy,
  pairUniverse,
  recentBacktests,
}: DeployStrategyWizardProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [selectedBacktest, setSelectedBacktest] = useState<string>(
    recentBacktests[0]?.id ?? '',
  )
  const [riskGbp, setRiskGbp] = useState(10)
  const [pairs, setPairs] = useState<string[]>([...strategy.pairs])
  // Universe-first ordering with anything the strategy specifically
  // mentions appended (deduped) so a strategy configured against a
  // ticker the operator later removed from the universe still
  // surfaces as a chip.
  const pairChoices = (() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const p of pairUniverse) {
      if (seen.has(p)) continue
      seen.add(p)
      out.push(p)
    }
    for (const p of strategy.pairs) {
      if (seen.has(p)) continue
      seen.add(p)
      out.push(p)
    }
    return out
  })()
  const [maxConcurrent, setMaxConcurrent] = useState(1)
  const [maxDailyLoss, setMaxDailyLoss] = useState<number | null>(50)
  const [maxConsecutiveLosers, setMaxConsecutiveLosers] = useState<
    number | null
  >(3)
  const [orderLifetime, setOrderLifetime] = useState(1)
  const [consent, setConsent] = useState(false)

  const selected = recentBacktests.find((b) => b.id === selectedBacktest)

  function togglePair(p: string) {
    setPairs((current) =>
      current.includes(p) ? current.filter((x) => x !== p) : [...current, p],
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        if (!consent) {
          setError('Confirm you understand live deployment risk before deploying.')
          return
        }
        if (pairs.length === 0) {
          setError('Pick at least one pair.')
          return
        }
        startTransition(async () => {
          const result = await deployStrategyAction({
            strategy_definition_id: strategy.id,
            live_risk_gbp: riskGbp,
            live_pairs: pairs,
            live_max_concurrent_positions: maxConcurrent,
            live_max_daily_loss_gbp: maxDailyLoss,
            live_max_consecutive_losers: maxConsecutiveLosers,
            live_order_lifetime_candles: orderLifetime,
            source_backtest_run_id: selectedBacktest || null,
          })
          if (!result.ok) {
            setError(result.message ?? 'Deploy failed')
            return
          }
          router.push('/live')
        })
      }}
      className="flex flex-col gap-6"
    >
      <Section title="Backtest justification">
        {recentBacktests.length === 0 ? (
          <p className="text-xs text-white/55">
            No completed backtest runs for this strategy. You can still
            deploy without one, but the live page will not be able to compute
            an &ldquo;edge captured&rdquo; comparison until at least one backtest run is
            attached.
          </p>
        ) : (
          <>
            <label className="block text-[10px] uppercase tracking-wider text-white/45">
              Source backtest run
            </label>
            <select
              value={selectedBacktest}
              onChange={(e) => setSelectedBacktest(e.target.value)}
              className="mt-1 w-full rounded border border-white/10 bg-bg px-3 py-2 text-sm text-white"
            >
              <option value="">(no backtest reference)</option>
              {recentBacktests.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {b.total_trades ?? 0} trades · {formatNumber(b.avg_r)}R
                </option>
              ))}
            </select>
            {selected ? (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Stat label="Trades" value={String(selected.total_trades ?? 0)} />
                <Stat label="Win rate" value={formatPct(selected.win_rate)} />
                <Stat label="Avg R" value={formatNumber(selected.avg_r)} />
                <Stat label="Total PnL" value={formatGbp(selected.total_pnl_gbp)} />
                <Stat
                  label="Max DD"
                  value={
                    selected.max_drawdown_gbp == null
                      ? '—'
                      : formatGbp(-Math.abs(selected.max_drawdown_gbp))
                  }
                />
              </div>
            ) : null}
            <p className="mt-3 text-[11px] text-white/55">
              Manual confirmation plus limit orders typically captures 50-70%
              of backtest edge for momentum strategies and 60-80% for mean
              reversion. Backtest avg R{' '}
              {selected?.avg_r != null ? formatNumber(selected.avg_r) : '—'} ⇒
              realistic live{' '}
              {selected?.avg_r != null
                ? `${formatNumber(selected.avg_r * 0.5)} to ${formatNumber(selected.avg_r * 0.7)}`
                : '—'}
              .
            </p>
          </>
        )}
      </Section>

      <Section title="Live config">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Live risk per trade (£)"
            type="number"
            step="0.01"
            value={riskGbp}
            onChange={(e) => setRiskGbp(Number(e.target.value))}
          />
          <Input
            label="Max concurrent positions"
            type="number"
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(Number(e.target.value))}
          />
          <Input
            label="Max daily loss (£) — blank to disable"
            type="number"
            step="0.01"
            value={maxDailyLoss ?? ''}
            onChange={(e) => {
              const v = e.target.value
              setMaxDailyLoss(v === '' ? null : Number(v))
            }}
          />
          <Input
            label="Max consecutive losers — blank to disable"
            type="number"
            value={maxConsecutiveLosers ?? ''}
            onChange={(e) => {
              const v = e.target.value
              setMaxConsecutiveLosers(v === '' ? null : Number(v))
            }}
          />
          <Input
            label="Order lifetime (candles)"
            type="number"
            value={orderLifetime}
            onChange={(e) => setOrderLifetime(Number(e.target.value))}
          />
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-white/45">
              Auto-execute
            </label>
            <div className="mt-1 rounded border border-white/10 bg-bg px-3 py-2 text-xs text-white/45">
              Off · Phase 2 only
            </div>
          </div>
        </div>
        <div className="mt-4">
          <span className="block text-[10px] uppercase tracking-wider text-white/45">
            Live pairs
          </span>
          <p className="mt-1 text-[11px] text-white/45">
            {strategy.pairs.length > 0
              ? `${strategy.pairs.length} pair${strategy.pairs.length === 1 ? '' : 's'} from this strategy are pre-selected. Click to toggle, or pick others from the universe.`
              : 'This strategy has no pre-configured pairs. Pick one or more from the universe below.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {pairChoices.length === 0 ? (
              <span className="text-[11px] text-white/45">
                No tradable pairs available. Add at least one symbol to the
                universe before deploying.
              </span>
            ) : (
              pairChoices.map((p) => {
                const selected = pairs.includes(p)
                const fromStrategy = strategy.pairs.includes(p)
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePair(p)}
                    title={fromStrategy ? 'Pre-configured on this strategy' : undefined}
                    className={
                      selected
                        ? 'rounded-full border border-accent bg-accent/15 px-2.5 py-0.5 text-[11px] text-white'
                        : 'rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] text-white/55 hover:border-white/20 hover:text-white'
                    }
                  >
                    {p}
                    {fromStrategy && !selected ? (
                      <span className="ml-1 text-[9px] text-white/35">★</span>
                    ) : null}
                  </button>
                )
              })
            )}
          </div>
        </div>
      </Section>

      <Section title="Confirmation">
        <p className="text-xs text-white/65">
          Deploying live means this strategy starts producing signals from
          the next scanner tick onwards. Phase 1 routes orders through a
          mock client, so no real money moves; Phase 2 will require an
          exchange-credentials row before the same flow places real orders.
        </p>
        <label className="mt-3 flex items-center gap-2 text-xs text-white/75">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          I understand this strategy will start firing signals as soon as I
          deploy it.
        </label>
      </Section>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending} className="w-auto">
          {isPending ? 'Deploying…' : 'Deploy live'}
        </Button>
      </div>
    </form>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/55">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/[0.06] bg-bg/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-white/45">
        {label}
      </div>
      <div className="mt-1 font-mono text-xs text-white/85">{value}</div>
    </div>
  )
}
