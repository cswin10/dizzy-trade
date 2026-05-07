'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'

import { executeWalkForwardRunAction } from '@/app/actions/walk-forward'
import type { BacktestTimeframe } from '@/lib/backtest/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

export type WalkForwardStrategyOption = {
  id: string
  name: string
  pairs: string[]
  timeframe: string
}

export type WalkForwardFormProps = {
  pairUniverse: string[]
  strategies: WalkForwardStrategyOption[]
  preselectedStrategyId?: string
}

const TIMEFRAME_OPTIONS = ['1h', '4h', '1d']

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export function WalkForwardForm({
  pairUniverse,
  strategies,
  preselectedStrategyId,
}: WalkForwardFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [strategyId, setStrategyId] = useState<string>(
    preselectedStrategyId ?? strategies[0]?.id ?? '',
  )
  const selectedStrategy = strategies.find((s) => s.id === strategyId)

  const [pairs, setPairs] = useState<string[]>(
    selectedStrategy?.pairs?.length
      ? [...selectedStrategy.pairs]
      : ['BTC', 'ETH', 'SOL'],
  )
  const [timeframe, setTimeframe] = useState<string>(
    selectedStrategy?.timeframe ?? '1h',
  )
  const [totalStart, setTotalStart] = useState<string>(daysAgoIso(360))
  const [totalEnd, setTotalEnd] = useState<string>(todayIso())
  const [windowSizeDays, setWindowSizeDays] = useState<number>(60)
  const [stepSizeDays, setStepSizeDays] = useState<number>(30)
  const [riskAmountGbp, setRiskAmountGbp] = useState<number>(30)
  const [minRr, setMinRr] = useState<number>(2)
  const [maxConcurrent, setMaxConcurrent] = useState<number>(3)
  const [maxDailyLoss, setMaxDailyLoss] = useState<number | null>(100)
  const [maxConsecutiveLosers, setMaxConsecutiveLosers] = useState<
    number | null
  >(5)
  const [makerFeePct, setMakerFeePct] = useState<number>(0.015)
  const [takerFeePct, setTakerFeePct] = useState<number>(0.045)
  const [slippagePct, setSlippagePct] = useState<number>(0.05)
  const [assumeTaker, setAssumeTaker] = useState<boolean>(true)

  const projectedWindows = useMemo(() => {
    const startMs = new Date(totalStart).getTime()
    const endMs = new Date(totalEnd).getTime()
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs <= startMs ||
      windowSizeDays <= 0 ||
      stepSizeDays <= 0
    ) {
      return 0
    }
    const dayMs = 24 * 60 * 60 * 1000
    const winMs = windowSizeDays * dayMs
    const stepMs = stepSizeDays * dayMs
    let count = 0
    let cursor = startMs
    while (cursor + winMs <= endMs) {
      count += 1
      cursor += stepMs
    }
    return count
  }, [totalStart, totalEnd, windowSizeDays, stepSizeDays])

  function togglePair(symbol: string) {
    setPairs((current) =>
      current.includes(symbol)
        ? current.filter((p) => p !== symbol)
        : [...current, symbol],
    )
  }

  function handleStrategyChange(id: string) {
    setStrategyId(id)
    const next = strategies.find((s) => s.id === id)
    if (next?.pairs?.length) setPairs([...next.pairs])
    if (next?.timeframe) setTimeframe(next.timeframe)
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!strategyId) {
      setError('Pick a strategy.')
      return
    }
    if (pairs.length === 0) {
      setError('Pick at least one pair.')
      return
    }
    if (projectedWindows === 0) {
      setError(
        'No windows fit the chosen range. Shorten the window or extend the date range.',
      )
      return
    }
    startTransition(async () => {
      const result = await executeWalkForwardRunAction({
        strategy_id: strategyId,
        total_start: totalStart,
        total_end: totalEnd,
        window_size_days: windowSizeDays,
        step_size_days: stepSizeDays,
        pairs,
        timeframe: timeframe as BacktestTimeframe,
        risk_amount_gbp: riskAmountGbp,
        min_rr: minRr,
        max_concurrent_positions: maxConcurrent,
        max_daily_loss_gbp: maxDailyLoss,
        max_consecutive_losers: maxConsecutiveLosers,
        slippage_pct: slippagePct,
        maker_fee_pct: makerFeePct,
        taker_fee_pct: takerFeePct,
        assume_taker: assumeTaker,
      })
      if (!result.ok) {
        setError(result.message ?? 'Walk-forward run failed')
        return
      }
      router.push(`/backtest/walk-forward/${result.id}`)
    })
  }

  const universeChoices = (() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const p of pairUniverse) {
      if (seen.has(p)) continue
      seen.add(p)
      out.push(p)
    }
    for (const p of pairs) {
      if (seen.has(p)) continue
      seen.add(p)
      out.push(p)
    }
    return out
  })()

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Section title="Strategy">
        {strategies.length === 0 ? (
          <p className="text-xs text-white/55">
            No composable strategies yet. Create one in Settings → Strategies
            before running a walk-forward.
          </p>
        ) : (
          <Select
            label="Strategy"
            value={strategyId}
            onChange={(e) => handleStrategyChange(e.target.value)}
          >
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.timeframe}
              </option>
            ))}
          </Select>
        )}
      </Section>

      <Section title="Walk-forward window">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Total range start"
            type="date"
            value={totalStart}
            onChange={(e) => setTotalStart(e.target.value)}
          />
          <Input
            label="Total range end"
            type="date"
            value={totalEnd}
            onChange={(e) => setTotalEnd(e.target.value)}
          />
          <Input
            label="Window size (days)"
            type="number"
            value={windowSizeDays}
            onChange={(e) => setWindowSizeDays(Number(e.target.value))}
          />
          <Input
            label="Step size (days)"
            type="number"
            value={stepSizeDays}
            onChange={(e) => setStepSizeDays(Number(e.target.value))}
          />
        </div>
        <p className="mt-3 text-[11px] text-white/55">
          Will produce <span className="font-mono text-white/85">{projectedWindows}</span>{' '}
          window{projectedWindows === 1 ? '' : 's'}. Each window is a separate
          backtest_run inheriting the config below.
        </p>
      </Section>

      <Section title="Backtest config">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Timeframe"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
          >
            {TIMEFRAME_OPTIONS.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </Select>
          <Input
            label="Risk per trade (£)"
            type="number"
            step="0.01"
            value={riskAmountGbp}
            onChange={(e) => setRiskAmountGbp(Number(e.target.value))}
          />
          <Input
            label="Min R:R"
            type="number"
            step="0.1"
            value={minRr}
            onChange={(e) => setMinRr(Number(e.target.value))}
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
            label="Maker fee %"
            type="number"
            step="0.001"
            value={makerFeePct}
            onChange={(e) => setMakerFeePct(Number(e.target.value))}
          />
          <Input
            label="Taker fee %"
            type="number"
            step="0.001"
            value={takerFeePct}
            onChange={(e) => setTakerFeePct(Number(e.target.value))}
          />
          <Input
            label="Slippage %"
            type="number"
            step="0.001"
            value={slippagePct}
            onChange={(e) => setSlippagePct(Number(e.target.value))}
          />
          <label className="mt-6 flex items-center gap-2 text-xs text-white/75">
            <input
              type="checkbox"
              checked={assumeTaker}
              onChange={(e) => setAssumeTaker(e.target.checked)}
            />
            Assume taker fills (more conservative)
          </label>
        </div>
        <div className="mt-4">
          <span className="block text-[10px] uppercase tracking-wider text-white/45">
            Pairs
          </span>
          <div className="mt-2 flex flex-wrap gap-1">
            {universeChoices.length === 0 ? (
              <span className="text-[11px] text-white/45">
                No tradable pairs available.
              </span>
            ) : (
              universeChoices.map((p) => {
                const selected = pairs.includes(p)
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePair(p)}
                    className={
                      selected
                        ? 'rounded-full border border-accent bg-accent/15 px-2.5 py-0.5 text-[11px] text-white'
                        : 'rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] text-white/55 hover:border-white/20 hover:text-white'
                    }
                  >
                    {p}
                  </button>
                )
              })
            )}
          </div>
        </div>
      </Section>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending} className="w-auto">
          {isPending ? 'Running…' : 'Run walk-forward'}
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
