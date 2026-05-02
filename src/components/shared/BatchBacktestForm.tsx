'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'

import { twMerge } from 'tailwind-merge'

import { createBatchBacktestAction } from '@/app/actions/batch-backtest'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

export type BatchStrategyOption = {
  source: 'composable' | 'framework'
  id: string
  name: string
  pairs: string[]
  timeframe: string
}

export type BatchBacktestFormProps = {
  pairUniverse: string[]
  strategies: BatchStrategyOption[]
  preselectedComposableIds?: string[]
  preselectedLegacyIds?: string[]
}

const TIMEFRAME_OPTIONS = ['1h', '4h', '1d']
const MIN_STRATEGIES = 2
const MAX_STRATEGIES = 20
const LARGE_BATCH_STRATEGIES = 10
const LARGE_BATCH_DAYS = 180

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function ninetyDaysAgoIso(): string {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().slice(0, 10)
}

function defaultBatchName(): string {
  const today = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  })
  return `Batch ${today}`
}

export function BatchBacktestForm({
  pairUniverse,
  strategies,
  preselectedComposableIds = [],
  preselectedLegacyIds = [],
}: BatchBacktestFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(defaultBatchName())
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<
    'all' | 'composable' | 'framework'
  >('all')
  const [selectedComposable, setSelectedComposable] = useState<Set<string>>(
    new Set(preselectedComposableIds),
  )
  const [selectedLegacy, setSelectedLegacy] = useState<Set<string>>(
    new Set(preselectedLegacyIds),
  )
  const [pairs, setPairs] = useState<string[]>(['BTC', 'ETH', 'SOL'])
  const [timeframe, setTimeframe] = useState<string>('1h')
  const [dateStart, setDateStart] = useState(ninetyDaysAgoIso())
  const [dateEnd, setDateEnd] = useState(todayIso())
  const [startingCapital, setStartingCapital] = useState(1000)
  const [feeBps, setFeeBps] = useState(4.5) // taker fee % default
  const [makerFee, setMakerFee] = useState(1.5)
  const [slippagePct, setSlippagePct] = useState(0.05)
  const [useNative, setUseNative] = useState(false)

  const totalSelected = selectedComposable.size + selectedLegacy.size

  const filteredStrategies = useMemo(() => {
    const q = search.trim().toLowerCase()
    return strategies.filter((s) => {
      if (sourceFilter !== 'all' && s.source !== sourceFilter) return false
      if (q.length > 0 && !s.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [strategies, search, sourceFilter])

  function toggleStrategy(s: BatchStrategyOption) {
    if (s.source === 'composable') {
      setSelectedComposable((current) => {
        const next = new Set(current)
        if (next.has(s.id)) {
          next.delete(s.id)
        } else if (totalSelected < MAX_STRATEGIES) {
          next.add(s.id)
        }
        return next
      })
    } else {
      setSelectedLegacy((current) => {
        const next = new Set(current)
        if (next.has(s.id)) {
          next.delete(s.id)
        } else if (totalSelected < MAX_STRATEGIES) {
          next.add(s.id)
        }
        return next
      })
    }
  }

  function togglePair(symbol: string) {
    setPairs((current) =>
      current.includes(symbol)
        ? current.filter((s) => s !== symbol)
        : [...current, symbol],
    )
  }

  const dateRangeDays = useMemo(() => {
    const start = new Date(dateStart).getTime()
    const end = new Date(dateEnd).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return 0
    }
    return Math.round((end - start) / (1000 * 60 * 60 * 24))
  }, [dateStart, dateEnd])
  const showLargeBatchWarning =
    totalSelected > LARGE_BATCH_STRATEGIES || dateRangeDays > LARGE_BATCH_DAYS

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (totalSelected < MIN_STRATEGIES) {
      setError(`Pick at least ${MIN_STRATEGIES} strategies.`)
      return
    }
    if (!useNative && pairs.length === 0) {
      setError('Select at least one pair (or enable strategy-native pairs).')
      return
    }
    startTransition(async () => {
      const result = await createBatchBacktestAction({
        name: name.trim().length > 0 ? name : null,
        shared: {
          pairs,
          timeframe,
          date_range_start: new Date(dateStart).toISOString(),
          date_range_end: new Date(dateEnd).toISOString(),
          starting_capital_gbp: startingCapital,
          maker_fee_pct: makerFee,
          taker_fee_pct: feeBps,
          slippage_pct: slippagePct,
          assume_taker: true,
          use_strategy_native_pairs: useNative,
        },
        strategy_definition_ids: Array.from(selectedComposable),
        legacy_strategy_ids: Array.from(selectedLegacy),
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      router.push(`/backtest/batch/${result.id}`)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Section title="Batch name">
        <Input
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Section>

      <Section title="Strategies">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name"
            className="h-9 w-60 rounded-md border border-white/10 bg-transparent px-2 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
          <div className="inline-flex rounded-md border border-white/10 bg-surface-2 p-0.5 text-xs">
            {(['all', 'composable', 'framework'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setSourceFilter(opt)}
                className={twMerge(
                  'rounded px-3 py-1 transition-colors',
                  sourceFilter === opt
                    ? 'bg-accent/20 text-white'
                    : 'text-white/55 hover:text-white',
                )}
              >
                {opt === 'all'
                  ? 'All'
                  : opt === 'composable'
                    ? 'Composable'
                    : 'Framework'}
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs text-white/45">
            {totalSelected} of {MAX_STRATEGIES} selected
          </span>
        </div>
        {filteredStrategies.length === 0 ? (
          <p className="rounded-md border border-white/[0.06] bg-surface-2 p-4 text-sm text-white/55">
            No strategies match.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {filteredStrategies.map((s) => {
              const isSelected =
                s.source === 'composable'
                  ? selectedComposable.has(s.id)
                  : selectedLegacy.has(s.id)
              const atCap = totalSelected >= MAX_STRATEGIES && !isSelected
              return (
                <li key={`${s.source}:${s.id}`}>
                  <label
                    className={twMerge(
                      'flex cursor-pointer items-center gap-3 rounded-md border border-white/[0.06] bg-surface px-3 py-2 transition-colors hover:border-white/10',
                      isSelected && 'border-accent/40 bg-accent/[0.06]',
                      atCap && 'opacity-40',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={atCap}
                      onChange={() => toggleStrategy(s)}
                    />
                    <span className="flex-1 text-sm text-white">{s.name}</span>
                    <span
                      className={twMerge(
                        'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
                        s.source === 'composable'
                          ? 'bg-accent/15 text-accent'
                          : 'bg-white/10 text-white/55',
                      )}
                    >
                      {s.source}
                    </span>
                    <span className="text-xs text-white/45">{s.timeframe}</span>
                    <span className="text-xs text-white/45">
                      {s.pairs.slice(0, 3).join(', ')}
                      {s.pairs.length > 3 ? ` +${s.pairs.length - 3}` : ''}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Common config">
        <label className="mb-3 flex items-center gap-2 text-sm text-white/65">
          <input
            type="checkbox"
            checked={useNative}
            onChange={(event) => setUseNative(event.target.checked)}
          />
          Use each strategy&apos;s own pairs and timeframe
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Timeframe"
            value={timeframe}
            onChange={(event) => setTimeframe(event.target.value)}
            disabled={useNative}
          >
            {TIMEFRAME_OPTIONS.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </Select>
          <Input
            label="Starting capital (£)"
            type="number"
            value={startingCapital}
            onChange={(event) => setStartingCapital(Number(event.target.value))}
          />
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
          <Input
            label="Maker fee %"
            type="number"
            step="0.001"
            value={makerFee}
            onChange={(event) => setMakerFee(Number(event.target.value))}
          />
          <Input
            label="Taker fee %"
            type="number"
            step="0.001"
            value={feeBps}
            onChange={(event) => setFeeBps(Number(event.target.value))}
          />
          <Input
            label="Slippage %"
            type="number"
            step="0.001"
            value={slippagePct}
            onChange={(event) => setSlippagePct(Number(event.target.value))}
          />
        </div>
        {!useNative ? (
          <div className="mt-3">
            <span className="mb-1 block text-xs text-white/45">Pairs</span>
            <div className="flex flex-wrap gap-1">
              {pairUniverse.map((symbol) => {
                const selected = pairs.includes(symbol)
                return (
                  <button
                    key={symbol}
                    type="button"
                    onClick={() => togglePair(symbol)}
                    className={twMerge(
                      'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                      selected
                        ? 'border-accent bg-accent/15 text-white'
                        : 'border-white/10 text-white/55 hover:border-white/20 hover:text-white',
                    )}
                  >
                    {symbol}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
      </Section>

      {showLargeBatchWarning ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          Large batches may take several minutes. Consider trimming the date
          range or strategy count if you hit the function timeout.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={isPending || totalSelected < MIN_STRATEGIES}
          className="w-auto"
        >
          {isPending
            ? 'Running batch…'
            : `Run batch (${totalSelected} ${totalSelected === 1 ? 'strategy' : 'strategies'})`}
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
