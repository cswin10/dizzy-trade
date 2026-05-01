'use client'

import { useMemo, useState } from 'react'

import { twMerge } from 'tailwind-merge'

export type BacktestTradeRow = {
  id: string
  pair: string
  direction: 'long' | 'short'
  entry_at: string
  entry_price: number
  stop_price: number
  target_price: number
  exit_at: string | null
  exit_price: number | null
  exit_reason: string | null
  r_multiple: number | null
  outcome: 'win' | 'loss' | 'breakeven' | null
  conditions_at_signal: Record<string, unknown> | null
}

export type BacktestTradesTableProps = {
  trades: BacktestTradeRow[]
}

const PAGE_SIZE = 20

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1000) return value.toFixed(0)
  if (Math.abs(value) >= 10) return value.toFixed(2)
  return value.toFixed(4)
}

export function BacktestTradesTable({ trades }: BacktestTradesTableProps) {
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all')
  const [pairFilter, setPairFilter] = useState<string>('all')
  const [directionFilter, setDirectionFilter] = useState<string>('all')
  const [page, setPage] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const pairOptions = useMemo(() => {
    const set = new Set(trades.map((t) => t.pair))
    return Array.from(set).sort()
  }, [trades])

  const filtered = useMemo(() => {
    return trades.filter((trade) => {
      if (outcomeFilter !== 'all' && trade.exit_reason !== outcomeFilter) {
        if (
          outcomeFilter === 'win' ||
          outcomeFilter === 'loss' ||
          outcomeFilter === 'breakeven'
        ) {
          if (trade.outcome !== outcomeFilter) return false
        } else {
          return false
        }
      }
      if (pairFilter !== 'all' && trade.pair !== pairFilter) return false
      if (directionFilter !== 'all' && trade.direction !== directionFilter)
        return false
      return true
    })
  }, [trades, outcomeFilter, pairFilter, directionFilter])

  const pageStart = page * PAGE_SIZE
  const pageItems = filtered.slice(pageStart, pageStart + PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <FilterSelect
          label="Outcome"
          value={outcomeFilter}
          onChange={(v) => {
            setOutcomeFilter(v)
            setPage(0)
          }}
          options={[
            { value: 'all', label: 'All outcomes' },
            { value: 'win', label: 'Wins' },
            { value: 'loss', label: 'Losses' },
            { value: 'breakeven', label: 'Breakeven' },
            { value: 'rules_blocked', label: 'Rules blocked' },
            { value: 'timeout', label: 'Timeout' },
          ]}
        />
        <FilterSelect
          label="Pair"
          value={pairFilter}
          onChange={(v) => {
            setPairFilter(v)
            setPage(0)
          }}
          options={[
            { value: 'all', label: 'All pairs' },
            ...pairOptions.map((p) => ({ value: p, label: p })),
          ]}
        />
        <FilterSelect
          label="Direction"
          value={directionFilter}
          onChange={(v) => {
            setDirectionFilter(v)
            setPage(0)
          }}
          options={[
            { value: 'all', label: 'All' },
            { value: 'long', label: 'Long' },
            { value: 'short', label: 'Short' },
          ]}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-white/[0.06] bg-surface">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-white/45">
            <tr>
              <th className="px-3 py-2 text-left">Entry</th>
              <th className="px-3 py-2 text-left">Pair</th>
              <th className="px-3 py-2 text-left">Dir</th>
              <th className="px-3 py-2 text-right">Entry $</th>
              <th className="px-3 py-2 text-right">Stop</th>
              <th className="px-3 py-2 text-right">Target</th>
              <th className="px-3 py-2 text-left">Exit</th>
              <th className="px-3 py-2 text-right">Exit $</th>
              <th className="px-3 py-2 text-left">Reason</th>
              <th className="px-3 py-2 text-right">R</th>
              <th className="px-3 py-2 text-left">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((trade) => {
              const expanded = expandedId === trade.id
              return (
                <>
                  <tr
                    key={trade.id}
                    onClick={() => setExpandedId(expanded ? null : trade.id)}
                    className="cursor-pointer border-t border-white/[0.04] text-white/80 hover:bg-surface-2"
                  >
                    <td className="px-3 py-2">{formatDate(trade.entry_at)}</td>
                    <td className="px-3 py-2 font-medium">{trade.pair}</td>
                    <td className="px-3 py-2 uppercase">
                      {trade.direction === 'long' ? 'L' : 'S'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatPrice(trade.entry_price)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatPrice(trade.stop_price)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatPrice(trade.target_price)}
                    </td>
                    <td className="px-3 py-2">{formatDate(trade.exit_at)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatPrice(trade.exit_price)}
                    </td>
                    <td className="px-3 py-2 text-white/55">
                      {trade.exit_reason ?? '—'}
                    </td>
                    <td
                      className={twMerge(
                        'px-3 py-2 text-right font-mono',
                        trade.r_multiple != null && trade.r_multiple > 0
                          ? 'text-emerald-300'
                          : trade.r_multiple != null && trade.r_multiple < 0
                            ? 'text-red-300'
                            : '',
                      )}
                    >
                      {trade.r_multiple != null
                        ? trade.r_multiple.toFixed(2)
                        : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={twMerge(
                          'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
                          trade.outcome === 'win' &&
                            'bg-emerald-500/15 text-emerald-300',
                          trade.outcome === 'loss' &&
                            'bg-red-500/15 text-red-300',
                          (!trade.outcome || trade.outcome === 'breakeven') &&
                            'bg-white/10 text-white/55',
                        )}
                      >
                        {trade.outcome ?? '—'}
                      </span>
                    </td>
                  </tr>
                  {expanded && trade.conditions_at_signal ? (
                    <tr key={`${trade.id}-detail`} className="bg-surface-2">
                      <td colSpan={11} className="px-4 py-3">
                        <div className="text-[10px] uppercase tracking-wider text-white/45">
                          Conditions at signal
                        </div>
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-white/65">
                          {JSON.stringify(trade.conditions_at_signal, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ) : null}
                </>
              )
            })}
            {pageItems.length === 0 ? (
              <tr>
                <td
                  colSpan={11}
                  className="px-3 py-6 text-center text-white/45"
                >
                  No trades match these filters
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-xs text-white/55">
          <span>
            Page {page + 1} of {totalPages} · {filtered.length} trades
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="rounded-md border border-white/10 px-3 py-1 transition-colors duration-200 hover:border-white/20 disabled:opacity-30"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-md border border-white/10 px-3 py-1 transition-colors duration-200 hover:border-white/20 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-white/45">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-white/10 bg-transparent px-2 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
