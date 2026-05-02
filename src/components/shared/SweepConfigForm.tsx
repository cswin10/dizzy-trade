'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'

import { twMerge } from 'tailwind-merge'

import { createSweepAction } from '@/app/actions/backtest-sweeps'
import {
  countCombinations,
  MAX_COMBINATIONS,
  type SweepDimension,
} from '@/lib/backtest/sweep'
import { BACKTEST_TIMEFRAMES } from '@/lib/backtest/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

import { SweepDimensionEditor } from './SweepDimensionEditor'

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

export type SweepComposableStrategyOption = {
  id: string
  name: string
  pairs: string[]
  timeframe: string
  max_concurrent_positions: number
  max_daily_loss_gbp: number | null
  max_consecutive_losers: number | null
  // The actual definition document. The dimension picker walks
  // entry.groups[N].conditions[M].params.* and offers each leaf
  // numeric path as a sweepable target.
  definition: import('@/lib/strategies/types').StrategyDefinition
}

export type SweepConfigFormProps = {
  pairUniverse: string[]
  defaultPairs?: string[]
  defaultFrameworkId?: string
  defaultTimeframe?: string
  composableStrategies?: SweepComposableStrategyOption[]
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function ninetyDaysAgoIso(): string {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().slice(0, 10)
}

export function SweepConfigForm({
  pairUniverse,
  defaultPairs,
  defaultFrameworkId,
  defaultTimeframe,
  composableStrategies = [],
}: SweepConfigFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(
    `Sweep ${new Date().toLocaleString('en-GB')}`,
  )
  const [frameworkId, setFrameworkId] = useState(
    defaultFrameworkId ?? 'simple_rsi_v1',
  )
  const [thresholds, setThresholds] = useState<Record<string, number>>(
    FRAMEWORK_DEFAULTS[defaultFrameworkId ?? 'simple_rsi_v1'] ??
      FRAMEWORK_DEFAULTS.simple_rsi_v1!,
  )
  const [timeframe, setTimeframe] = useState<string>(defaultTimeframe ?? '1h')
  const [pairs, setPairs] = useState<string[]>(
    defaultPairs && defaultPairs.length > 0
      ? defaultPairs
      : ['BTC', 'ETH', 'SOL'],
  )
  const [dateStart, setDateStart] = useState(ninetyDaysAgoIso())
  const [dateEnd, setDateEnd] = useState(todayIso())
  const [riskAmountGbp, setRiskAmountGbp] = useState(30)
  const [minRr, setMinRr] = useState(2)
  const [maxConcurrent, setMaxConcurrent] = useState(3)
  const [maxDailyLoss, setMaxDailyLoss] = useState<number | null>(100)
  const [maxConsecLosers, setMaxConsecLosers] = useState<number | null>(5)
  const [slippagePct, setSlippagePct] = useState(0.05)
  const [makerFeePct, setMakerFeePct] = useState(0.015)
  const [takerFeePct, setTakerFeePct] = useState(0.045)
  const [assumeTaker, setAssumeTaker] = useState(true)
  const [enableSplit, setEnableSplit] = useState(true)
  const [trainSplitPct, setTrainSplitPct] = useState(70)

  const [strategySource, setStrategySource] = useState<
    'framework' | 'composable'
  >('framework')
  const [strategyDefinitionId, setStrategyDefinitionId] = useState<string>(
    composableStrategies[0]?.id ?? '',
  )
  const composableSelected = composableStrategies.find(
    (s) => s.id === strategyDefinitionId,
  )

  // For composable sweeps, the dimension picker offers JSON paths
  // into the chosen strategy's definition. We surface every numeric
  // condition param as a sweepable path with a friendly label so
  // the operator can pick "RSI threshold value (group 1, condition 1)"
  // rather than typing the path by hand.
  const composablePathSuggestions = useMemo<
    Array<{ path: string; label: string }>
  >(() => {
    if (strategySource !== 'composable' || !composableSelected) return []
    const out: Array<{ path: string; label: string }> = []
    const def = composableSelected.definition
    def.entry.groups.forEach((group, gi) => {
      group.conditions.forEach((cond, ci) => {
        for (const [key, value] of Object.entries(cond.params)) {
          if (typeof value === 'number') {
            out.push({
              path: `entry.groups[${gi}].conditions[${ci}].params.${key}`,
              label: `${cond.type} ${key} (group ${gi + 1}, condition ${ci + 1})`,
            })
          }
        }
      })
    })
    // Stop / target / sizing scalar params
    for (const [k, v] of Object.entries(def.exit.stop)) {
      if (typeof v === 'number')
        out.push({ path: `exit.stop.${k}`, label: `stop ${k}` })
    }
    for (const [k, v] of Object.entries(def.exit.target)) {
      if (typeof v === 'number')
        out.push({ path: `exit.target.${k}`, label: `target ${k}` })
    }
    for (const [k, v] of Object.entries(def.sizing)) {
      if (typeof v === 'number')
        out.push({ path: `sizing.${k}`, label: `sizing ${k}` })
    }
    return out
  }, [strategySource, composableSelected])

  const [dimensions, setDimensions] = useState<SweepDimension[]>([])
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  const totalCombos = useMemo(() => countCombinations(dimensions), [dimensions])
  const overLimit = totalCombos > MAX_COMBINATIONS

  function changeFramework(id: string) {
    setFrameworkId(id)
    setThresholds(FRAMEWORK_DEFAULTS[id] ?? {})
    setDimensions([])
  }

  function togglePair(symbol: string) {
    setPairs((current) =>
      current.includes(symbol)
        ? current.filter((s) => s !== symbol)
        : [...current, symbol],
    )
  }

  function saveDimension(dimension: SweepDimension) {
    setDimensions((current) => {
      if (editingIndex !== null) {
        const next = [...current]
        next[editingIndex] = dimension
        return next
      }
      return [...current, dimension]
    })
    setEditorOpen(false)
    setEditingIndex(null)
  }

  function removeDimension(index: number) {
    setDimensions((current) => current.filter((_, i) => i !== index))
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (dimensions.length === 0) {
      setError('Add at least one sweep dimension')
      return
    }
    if (overLimit) {
      setError(
        `Reduce ranges. Max ${MAX_COMBINATIONS} combinations (this sweep would produce ${totalCombos}).`,
      )
      return
    }
    if (pairs.length === 0) {
      setError('Select at least one pair')
      return
    }
    if (new Date(dateEnd) <= new Date(dateStart)) {
      setError('End date must be after start date')
      return
    }

    if (strategySource === 'composable' && !strategyDefinitionId) {
      setError('Pick a composable strategy from the dropdown.')
      return
    }

    startTransition(async () => {
      const baseConfig = {
        name,
        timeframe: timeframe as (typeof BACKTEST_TIMEFRAMES)[number],
        pairs,
        date_range_start: new Date(dateStart),
        date_range_end: new Date(dateEnd),
        risk_amount_gbp: riskAmountGbp,
        min_rr: minRr,
        max_concurrent_positions: maxConcurrent,
        max_daily_loss_gbp: maxDailyLoss,
        max_consecutive_losers: maxConsecLosers,
        slippage_pct: slippagePct,
        maker_fee_pct: makerFeePct,
        taker_fee_pct: takerFeePct,
        assume_taker: assumeTaker,
        enable_train_test_split: enableSplit,
        train_split_pct: trainSplitPct,
        dimensions,
      } as const
      const result = await createSweepAction(
        strategySource === 'composable'
          ? {
              ...baseConfig,
              strategy_definition_id: strategyDefinitionId,
            }
          : {
              ...baseConfig,
              framework_id: frameworkId,
              framework_thresholds: thresholds,
            },
      )
      if (!result.ok || !result.id) {
        setError(result.message ?? 'Failed to create sweep')
        return
      }
      router.push(`/backtest/sweeps/${result.id}`)
    })
  }

  const thresholdKeys = Object.keys(thresholds)

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Section title="Run">
        <Input
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </Section>

      <Section title="Base config">
        {composableStrategies.length > 0 ? (
          <div className="mb-3 inline-flex rounded-md border border-white/10 bg-surface-2 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setStrategySource('framework')}
              className={twMerge(
                'rounded px-3 py-1 transition-colors',
                strategySource === 'framework'
                  ? 'bg-accent/20 text-white'
                  : 'text-white/55 hover:text-white',
              )}
            >
              Framework
            </button>
            <button
              type="button"
              onClick={() => setStrategySource('composable')}
              className={twMerge(
                'rounded px-3 py-1 transition-colors',
                strategySource === 'composable'
                  ? 'bg-accent/20 text-white'
                  : 'text-white/55 hover:text-white',
              )}
            >
              Composable strategy
            </button>
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          {strategySource === 'composable' ? (
            <Select
              label="Composable strategy"
              value={strategyDefinitionId}
              onChange={(event) => {
                const next = event.target.value
                setStrategyDefinitionId(next)
                const found = composableStrategies.find((s) => s.id === next)
                if (found) {
                  setPairs(found.pairs)
                  setTimeframe(found.timeframe)
                  setMaxConcurrent(found.max_concurrent_positions)
                  setMaxDailyLoss(found.max_daily_loss_gbp)
                  setMaxConsecLosers(found.max_consecutive_losers)
                }
                setDimensions([])
              }}
            >
              {composableStrategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          ) : (
            <Select
              label="Framework"
              value={frameworkId}
              onChange={(event) => changeFramework(event.target.value)}
            >
              {FRAMEWORK_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          )}
          <Select
            label="Timeframe"
            value={timeframe}
            onChange={(event) => setTimeframe(event.target.value)}
          >
            {BACKTEST_TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </Select>
          <Input
            label="Start date"
            type="date"
            value={dateStart}
            onChange={(event) => setDateStart(event.target.value)}
          />
          <Input
            label="End date"
            type="date"
            value={dateEnd}
            onChange={(event) => setDateEnd(event.target.value)}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
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
        <details className="mt-4 rounded-md border border-white/[0.06] bg-surface-2 p-3">
          <summary className="cursor-pointer text-xs uppercase tracking-wider text-white/55">
            Default values for non-swept parameters
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              label="Risk per trade (£)"
              type="number"
              step="any"
              value={riskAmountGbp}
              onChange={(event) => setRiskAmountGbp(Number(event.target.value))}
            />
            <Input
              label="Min R:R"
              type="number"
              step="any"
              value={minRr}
              onChange={(event) => setMinRr(Number(event.target.value))}
            />
            <Input
              label="Max concurrent"
              type="number"
              step="1"
              value={maxConcurrent}
              onChange={(event) => setMaxConcurrent(Number(event.target.value))}
            />
            <Input
              label="Max daily loss (£)"
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
              label="Max consecutive losers"
              type="number"
              step="1"
              value={maxConsecLosers ?? ''}
              onChange={(event) =>
                setMaxConsecLosers(
                  event.target.value === '' ? null : Number(event.target.value),
                )
              }
            />
            <Input
              label="Slippage %"
              type="number"
              step="any"
              value={slippagePct}
              onChange={(event) => setSlippagePct(Number(event.target.value))}
            />
            <Input
              label="Maker fee %"
              type="number"
              step="any"
              value={makerFeePct}
              onChange={(event) => setMakerFeePct(Number(event.target.value))}
            />
            <Input
              label="Taker fee %"
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
            Assume taker fills
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm text-white/65">
            <input
              type="checkbox"
              checked={enableSplit}
              onChange={(event) => setEnableSplit(event.target.checked)}
            />
            Enable train and test split
          </label>
          {enableSplit ? (
            <label className="mt-2 flex flex-col gap-1 text-xs text-white/45">
              Train split: {trainSplitPct}%
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
          ) : null}
        </details>
      </Section>

      <Section title="Sweep dimensions">
        <ul className="flex flex-col gap-2">
          {dimensions.map((dim, index) => (
            <li
              key={index}
              className="flex items-center justify-between rounded-md border border-white/[0.06] bg-surface-2 px-3 py-2"
            >
              <div>
                <div className="text-sm font-medium text-white">{dim.key}</div>
                <div className="font-mono text-xs text-white/55">
                  {dim.type === 'range'
                    ? `range ${dim.start} → ${dim.end} step ${dim.step}`
                    : dim.type === 'enum'
                      ? `enum [${dim.values.join(', ')}]`
                      : 'boolean (true, false)'}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingIndex(index)
                    setEditorOpen(true)
                  }}
                  className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/65 transition-colors hover:border-white/25 hover:text-white"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => removeDimension(index)}
                  className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/55 transition-colors hover:border-red-500/40 hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        {editorOpen ? (
          <div className="mt-3">
            <SweepDimensionEditor
              thresholdKeys={thresholdKeys}
              pathSuggestions={
                strategySource === 'composable'
                  ? composablePathSuggestions
                  : undefined
              }
              initial={
                editingIndex !== null ? dimensions[editingIndex] : undefined
              }
              onSave={saveDimension}
              onCancel={() => {
                setEditorOpen(false)
                setEditingIndex(null)
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditingIndex(null)
              setEditorOpen(true)
            }}
            className="mt-3 rounded-md border border-dashed border-white/10 px-3 py-2 text-xs text-white/55 transition-colors hover:border-accent hover:text-white"
          >
            + Add dimension
          </button>
        )}
        <div
          className={twMerge(
            'mt-3 text-sm',
            overLimit ? 'text-red-300' : 'text-white/65',
          )}
        >
          Total combinations: {totalCombos}
          {overLimit ? ` (exceeds max ${MAX_COMBINATIONS})` : null}
        </div>
      </Section>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={isPending || dimensions.length === 0 || overLimit}
          className="w-auto"
        >
          {isPending ? 'Creating sweep…' : 'Run sweep'}
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
