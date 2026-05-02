'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { twMerge } from 'tailwind-merge'

export type SweepResultRow = {
  run_id: string
  combination_index: number
  combination_values: Record<string, number | string | boolean>
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  total_trades: number | null
  win_rate: number | null
  avg_r: number | null
  total_pnl_gbp: number | null
  max_drawdown_gbp: number | null
  sharpe_ratio: number | null
  overfit_warning_triggered: boolean | null
}

export type SweepResultsTableProps = {
  rows: SweepResultRow[]
}

type SortKey =
  | 'combination'
  | 'total_trades'
  | 'win_rate'
  | 'avg_r'
  | 'total_pnl_gbp'
  | 'max_drawdown_gbp'
  | 'sharpe_ratio'
type SortDir = 'asc' | 'desc'

function formatGbp(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const sign = value < 0 ? '-' : ''
  return `${sign}£${Math.abs(value).toLocaleString('en-GB', {
    maximumFractionDigits: 0,
  })}`
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

function formatNumber(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

function describeCombo(
  values: Record<string, number | string | boolean>,
): string {
  const entries = Object.entries(values)
  if (entries.length === 0) return '—'
  return entries
    .map(([key, value]) => {
      if (typeof value === 'number') {
        return `${key}=${Number.isInteger(value) ? value : value.toFixed(4).replace(/\.?0+$/, '')}`
      }
      return `${key}=${value}`
    })
    .join(', ')
}

export function SweepResultsTable({ rows }: SweepResultsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('total_pnl_gbp')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [minTrades, setMinTrades] = useState(0)
  const [holdsUpOnly, setHoldsUpOnly] = useState(false)

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if ((row.total_trades ?? 0) < minTrades) return false
      if (holdsUpOnly && row.overfit_warning_triggered === true) return false
      return true
    })
  }, [rows, minTrades, holdsUpOnly])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      let av: number | string = 0
      let bv: number | string = 0
      if (sortKey === 'combination') {
        av = a.combination_index
        bv = b.combination_index
      } else {
        av = (a[sortKey] as number | null) ?? -Infinity
        bv = (b[sortKey] as number | null) ?? -Infinity
      }
      if (av === bv) return 0
      const cmp = av < bv ? -1 : 1
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [filtered, sortKey, sortDir])

  function clickHeader(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'combination' ? 'asc' : 'desc')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs text-white/45">
          Min trades
          <input
            type="number"
            min={0}
            value={minTrades}
            onChange={(event) => setMinTrades(Number(event.target.value))}
            className="h-9 w-24 rounded-md border border-white/10 bg-transparent px-2 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-white/65">
          <input
            type="checkbox"
            checked={holdsUpOnly}
            onChange={(event) => setHoldsUpOnly(event.target.checked)}
          />
          Holds up out of sample only
        </label>
        <span className="text-xs text-white/45">
          {sorted.length} of {rows.length} combinations
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-white/[0.06] bg-surface">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-white/45">
            <tr>
              <Th
                onClick={() => clickHeader('combination')}
                active={sortKey === 'combination'}
                dir={sortDir}
                align="left"
              >
                Combination
              </Th>
              <Th
                onClick={() => clickHeader('total_trades')}
                active={sortKey === 'total_trades'}
                dir={sortDir}
                align="right"
              >
                Trades
              </Th>
              <Th
                onClick={() => clickHeader('win_rate')}
                active={sortKey === 'win_rate'}
                dir={sortDir}
                align="right"
              >
                Win rate
              </Th>
              <Th
                onClick={() => clickHeader('avg_r')}
                active={sortKey === 'avg_r'}
                dir={sortDir}
                align="right"
              >
                Avg R
              </Th>
              <Th
                onClick={() => clickHeader('total_pnl_gbp')}
                active={sortKey === 'total_pnl_gbp'}
                dir={sortDir}
                align="right"
              >
                Total PnL
              </Th>
              <Th
                onClick={() => clickHeader('max_drawdown_gbp')}
                active={sortKey === 'max_drawdown_gbp'}
                dir={sortDir}
                align="right"
              >
                Max DD
              </Th>
              <Th
                onClick={() => clickHeader('sharpe_ratio')}
                active={sortKey === 'sharpe_ratio'}
                dir={sortDir}
                align="right"
              >
                Sharpe
              </Th>
              <th className="px-3 py-2 text-left">OOS</th>
              <th className="px-3 py-2 text-right">Run</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.run_id}
                className="border-t border-white/[0.04] text-white/85"
              >
                <td className="px-3 py-2 font-mono text-[11px]">
                  {describeCombo(row.combination_values)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {row.total_trades ?? '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {formatPct(row.win_rate)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {formatNumber(row.avg_r)}
                </td>
                <td
                  className={twMerge(
                    'px-3 py-2 text-right font-mono',
                    (row.total_pnl_gbp ?? 0) > 0 && 'text-emerald-300',
                    (row.total_pnl_gbp ?? 0) < 0 && 'text-red-300',
                  )}
                >
                  {formatGbp(row.total_pnl_gbp)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {formatGbp(row.max_drawdown_gbp)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {formatNumber(row.sharpe_ratio)}
                </td>
                <td className="px-3 py-2">
                  {row.status !== 'completed' ? (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/45">
                      {row.status}
                    </span>
                  ) : row.overfit_warning_triggered ? (
                    <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-red-300">
                      overfit
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                      holds
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    href={`/backtest/${row.run_id}`}
                    className="text-xs text-accent hover:underline"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-white/45">
                  No combinations match these filters
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({
  children,
  onClick,
  active,
  dir,
  align,
}: {
  children: React.ReactNode
  onClick: () => void
  active: boolean
  dir: SortDir
  align: 'left' | 'right'
}) {
  return (
    <th
      className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={twMerge(
          'inline-flex items-center gap-1 text-[10px] uppercase tracking-wider transition-colors',
          active ? 'text-white' : 'text-white/45 hover:text-white/70',
        )}
      >
        {children}
        {active ? <span>{dir === 'asc' ? '↑' : '↓'}</span> : null}
      </button>
    </th>
  )
}
