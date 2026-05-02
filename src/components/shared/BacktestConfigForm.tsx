'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'

import { twMerge } from 'tailwind-merge'

import {
  createBacktestRunAction,
  executeBacktestRunAction,
} from '@/app/actions/backtest'
import { BACKTEST_TIMEFRAMES } from '@/lib/backtest/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

const FRAMEWORK_OPTIONS = [
  { id: 'mean_reversion_v1', name: 'Mean Reversion' },
  { id: 'narrative_breakout_v1', name: 'Narrative Breakout' },
  { id: 'liquidation_hunt_v1', name: 'Liquidation Hunt' },
  { id: 'simple_rsi_v1', name: 'Simple RSI' },
] as const

const FRAMEWORK_DEFAULTS: Record<string, Record<string, number>> = {
  mean_reversion_v1: {
    swing_lookback_candles: 50,
    swing_min_age_candles: 10,
    level_proximity_pct: 0.005,
    rsi_period: 14,
    rsi_lookback_candles: 20,
    rsi_overbought: 65,
    rsi_oversold: 35,
    rejection_wick_body_ratio: 2.0,
    rejection_close_position_threshold: 0.6,
    funding_stretch_long_setup: -0.003,
    funding_stretch_short_setup: 0.01,
  },
  narrative_breakout_v1: {
    breakout_lookback_candles: 20,
    volume_multiplier: 1.5,
    btc_outperformance_24h: 0.05,
    funding_min_hourly: 0,
    funding_max_hourly: 0.005,
    heat_score_absolute: 0.7,
    heat_delta_6h: 0.15,
  },
  liquidation_hunt_v1: {
    funding_threshold: 0.0001,
    oi_elevation_multiplier: 1.3,
    wick_to_body_ratio: 1.5,
    stop_buffer: 0.002,
    target_rr_multiple: 2.0,
  },
  simple_rsi_v1: {
    rsi_period: 14,
    rsi_oversold: 30,
    rsi_overbought: 70,
    stop_pct: 1.0,
    target_pct: 2.0,
  },
}

export type BacktestConfigFormProps = {
  pairUniverse: string[]
  defaultPairs?: string[]
  defaultFrameworkId?: string
  defaultTimeframe?: string
  defaultRiskAmountGbp?: number
  defaultMinRr?: number
  defaultMaxConcurrent?: number
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function ninetyDaysAgoIso(): string {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().slice(0, 10)
}

function defaultName(): string {
  const today = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  })
  return `Backtest ${today}`
}

export function BacktestConfigForm({
  pairUniverse,
  defaultPairs,
  defaultFrameworkId,
  defaultTimeframe,
  defaultRiskAmountGbp,
  defaultMinRr,
  defaultMaxConcurrent,
}: BacktestConfigFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [statusText, setStatusText] = useState<string | null>(null)

  const [name, setName] = useState(defaultName())
  const [frameworkId, setFrameworkId] = useState(
    defaultFrameworkId ?? 'mean_reversion_v1',
  )
  const [thresholds, setThresholds] = useState<Record<string, number>>(
    FRAMEWORK_DEFAULTS[defaultFrameworkId ?? 'mean_reversion_v1'] ??
      FRAMEWORK_DEFAULTS.mean_reversion_v1!,
  )
  const [timeframe, setTimeframe] = useState<string>(defaultTimeframe ?? '1h')
  const [pairs, setPairs] = useState<string[]>(
    defaultPairs && defaultPairs.length > 0
      ? defaultPairs
      : ['BTC', 'ETH', 'SOL'],
  )
  const [customPair, setCustomPair] = useState('')
  const [riskAmountGbp, setRiskAmountGbp] = useState(defaultRiskAmountGbp ?? 30)
  const [minRr, setMinRr] = useState(defaultMinRr ?? 2)
  const [maxConcurrent, setMaxConcurrent] = useState(defaultMaxConcurrent ?? 3)
  const [maxDailyLoss, setMaxDailyLoss] = useState<number | null>(100)
  const [maxConsecLosers, setMaxConsecLosers] = useState<number | null>(5)
  const [dateStart, setDateStart] = useState(ninetyDaysAgoIso())
  const [dateEnd, setDateEnd] = useState(todayIso())
  const [slippagePct, setSlippagePct] = useState(0.05)
  const [makerFeePct, setMakerFeePct] = useState(0.015)
  const [takerFeePct, setTakerFeePct] = useState(0.045)
  const [assumeTaker, setAssumeTaker] = useState(true)
  const [enableSplit, setEnableSplit] = useState(true)
  const [trainSplitPct, setTrainSplitPct] = useState(70)

  const estimatedRuntimeMs = useMemo(() => {
    const start = new Date(dateStart).getTime()
    const end = new Date(dateEnd).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return 0
    }
    const days = (end - start) / (24 * 60 * 60 * 1000)
    const candlesPerDay: Record<string, number> = {
      '1m': 1440,
      '5m': 288,
      '15m': 96,
      '30m': 48,
      '1h': 24,
      '4h': 6,
      '1d': 1,
    }
    const candlesPerPair = days * (candlesPerDay[timeframe] ?? 24)
    const total = candlesPerPair * pairs.length
    // Rough heuristic: 0.05ms per candle for evaluation, plus a
    // minimum of 5s for fixed costs (FX rate, candle fetch).
    return Math.max(5000, total * 0.05)
  }, [dateStart, dateEnd, timeframe, pairs.length])

  const willTimeout = estimatedRuntimeMs > 4 * 60 * 1000

  function togglePair(symbol: string) {
    setPairs((current) =>
      current.includes(symbol)
        ? current.filter((s) => s !== symbol)
        : [...current, symbol],
    )
  }

  function addCustomPair() {
    const symbol = customPair.trim().toUpperCase()
    if (!symbol) return
    if (!/^[A-Z0-9]+$/.test(symbol)) {
      setError('Custom symbol must be uppercase letters and digits')
      return
    }
    if (!pairs.includes(symbol)) setPairs([...pairs, symbol])
    setCustomPair('')
    setError(null)
  }

  function changeFramework(id: string) {
    setFrameworkId(id)
    setThresholds(FRAMEWORK_DEFAULTS[id] ?? {})
  }

  function updateThreshold(key: string, value: number) {
    setThresholds((current) => ({ ...current, [key]: value }))
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setStatusText(null)

    if (pairs.length === 0) {
      setError('Select at least one pair')
      return
    }
    if (new Date(dateEnd) <= new Date(dateStart)) {
      setError('End date must be after start date')
      return
    }

    startTransition(async () => {
      setStatusText('Creating run…')
      const created = await createBacktestRunAction({
        name,
        framework_id: frameworkId,
        framework_thresholds: thresholds,
        timeframe: timeframe as (typeof BACKTEST_TIMEFRAMES)[number],
        pairs,
        risk_amount_gbp: riskAmountGbp,
        min_rr: minRr,
        max_concurrent_positions: maxConcurrent,
        max_daily_loss_gbp: maxDailyLoss,
        max_consecutive_losers: maxConsecLosers,
        date_range_start: new Date(dateStart),
        date_range_end: new Date(dateEnd),
        slippage_pct: slippagePct,
        maker_fee_pct: makerFeePct,
        taker_fee_pct: takerFeePct,
        assume_taker: assumeTaker,
        enable_train_test_split: enableSplit,
        train_split_pct: trainSplitPct,
      })
      if (!created.ok || !created.id) {
        setError(created.message ?? 'Failed to create run')
        setStatusText(null)
        return
      }
      const runId = created.id
      router.push(`/backtest/${runId}`)
      setStatusText('Running backtest, this may take 30 to 120 seconds…')
      const executed = await executeBacktestRunAction(runId)
      if (!executed.ok) {
        setError(executed.message ?? 'Backtest failed')
      }
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Section title="Run">
        <Input
          label="Name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </Section>

      <Section title="Strategy">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Framework"
            name="framework_id"
            value={frameworkId}
            onChange={(event) => changeFramework(event.target.value)}
          >
            {FRAMEWORK_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
          <Select
            label="Timeframe"
            name="timeframe"
            value={timeframe}
            onChange={(event) => setTimeframe(event.target.value)}
          >
            {BACKTEST_TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </Select>
        </div>
        {Object.keys(thresholds).length > 0 ? (
          <details className="mt-4 rounded-md border border-white/[0.06] bg-surface-2 p-3">
            <summary className="cursor-pointer text-xs uppercase tracking-wider text-white/55">
              Framework thresholds
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {Object.entries(thresholds).map(([key, value]) => (
                <Input
                  key={key}
                  label={key}
                  name={`threshold_${key}`}
                  type="number"
                  step="any"
                  value={value}
                  onChange={(event) =>
                    updateThreshold(key, Number(event.target.value))
                  }
                />
              ))}
            </div>
          </details>
        ) : null}
      </Section>

      <Section title="Pairs">
        <div className="flex flex-wrap gap-2">
          {pairUniverse.map((symbol) => {
            const selected = pairs.includes(symbol)
            return (
              <button
                key={symbol}
                type="button"
                onClick={() => togglePair(symbol)}
                className={twMerge(
                  'rounded-full border px-3 py-1 text-xs transition-colors duration-200',
                  selected
                    ? 'border-accent bg-accent/15 text-white'
                    : 'border-white/10 bg-transparent text-white/55 hover:border-white/20 hover:text-white',
                )}
              >
                {symbol}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex gap-2">
          <Input
            label="Add custom pair"
            name="custom_pair"
            value={customPair}
            placeholder="e.g. SUI"
            onChange={(event) => setCustomPair(event.target.value)}
          />
          <div className="flex items-end">
            <Button
              type="button"
              variant="ghost"
              onClick={addCustomPair}
              className="w-auto"
            >
              Add
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Risk and rules">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Risk per trade (£)"
            name="risk_amount_gbp"
            type="number"
            step="any"
            value={riskAmountGbp}
            onChange={(event) => setRiskAmountGbp(Number(event.target.value))}
          />
          <Input
            label="Min R:R"
            name="min_rr"
            type="number"
            step="any"
            value={minRr}
            onChange={(event) => setMinRr(Number(event.target.value))}
          />
          <Input
            label="Max concurrent positions"
            name="max_concurrent_positions"
            type="number"
            step="1"
            value={maxConcurrent}
            onChange={(event) => setMaxConcurrent(Number(event.target.value))}
          />
          <Input
            label="Max daily loss (£, blank to disable)"
            name="max_daily_loss_gbp"
            type="number"
            step="any"
            value={maxDailyLoss ?? ''}
            onChange={(event) =>
              setMaxDailyLoss(
                event.target.value === '' ? null : Number(event.target.value),
              )
            }
          />
          <Input
            label="Max consecutive losers (blank to disable)"
            name="max_consecutive_losers"
            type="number"
            step="1"
            value={maxConsecLosers ?? ''}
            onChange={(event) =>
              setMaxConsecLosers(
                event.target.value === '' ? null : Number(event.target.value),
              )
            }
          />
        </div>
      </Section>

      <Section title="Date range">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Start date"
            name="date_range_start"
            type="date"
            value={dateStart}
            onChange={(event) => setDateStart(event.target.value)}
          />
          <Input
            label="End date"
            name="date_range_end"
            type="date"
            value={dateEnd}
            onChange={(event) => setDateEnd(event.target.value)}
          />
        </div>
      </Section>

      <Section title="Execution model">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Slippage %"
            name="slippage_pct"
            type="number"
            step="any"
            value={slippagePct}
            onChange={(event) => setSlippagePct(Number(event.target.value))}
          />
          <Input
            label="Maker fee %"
            name="maker_fee_pct"
            type="number"
            step="any"
            value={makerFeePct}
            onChange={(event) => setMakerFeePct(Number(event.target.value))}
          />
          <Input
            label="Taker fee %"
            name="taker_fee_pct"
            type="number"
            step="any"
            value={takerFeePct}
            onChange={(event) => setTakerFeePct(Number(event.target.value))}
          />
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-white/65">
          <input
            type="checkbox"
            checked={assumeTaker}
            onChange={(event) => setAssumeTaker(event.target.checked)}
          />
          Assume taker fills (recommended for stop and target orders)
        </label>
      </Section>

      <Section title="Train and test split">
        <label className="flex items-center gap-2 text-sm text-white/65">
          <input
            type="checkbox"
            checked={enableSplit}
            onChange={(event) => setEnableSplit(event.target.checked)}
          />
          Enable train and test split
        </label>
        {enableSplit ? (
          <div className="mt-3">
            <label className="flex flex-col gap-2 text-xs text-white/45">
              Train split %: {trainSplitPct}
              <input
                type="range"
                min={50}
                max={90}
                step={5}
                value={trainSplitPct}
                onChange={(event) =>
                  setTrainSplitPct(Number(event.target.value))
                }
                className="accent-accent"
              />
            </label>
          </div>
        ) : null}
      </Section>

      {willTimeout ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          Estimated runtime is over 4 minutes. Vercel functions cap at 5
          minutes; consider shortening the date range, dropping pairs, or using
          a higher timeframe.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {statusText ? (
        <div className="rounded-md border border-accent/30 bg-accent/10 p-3 text-sm text-white/80">
          {statusText}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending} className="w-auto">
          {isPending ? 'Running…' : 'Run backtest'}
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
      <h2 className="mb-4 text-[11px] font-medium uppercase tracking-wider text-white/55">
        {title}
      </h2>
      {children}
    </section>
  )
}
