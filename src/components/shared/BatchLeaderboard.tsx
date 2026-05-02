'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { twMerge } from 'tailwind-merge'

import type { BatchBacktestDetail } from '@/app/actions/batch-backtest'

export type BatchLeaderboardProps = {
  runs: BatchBacktestDetail['runs']
}

type SortKey =
  | 'name'
  | 'total_trades'
  | 'win_rate'
  | 'avg_r'
  | 'total_pnl_gbp'
  | 'sharpe_ratio'
  | 'max_drawdown_gbp'
  | 'expectancy_per_trade_gbp'
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

// Identifies the row that holds the best value for a given column.
// Bigger-is-better for everything except max drawdown, where the
// best value is the smallest (closest to zero) magnitude.
function bestRunIdFor(
  runs: BatchLeaderboardProps['runs'],
  key: SortKey,
): string | null {
  let best: { id: string; value: number } | null = null
  for (const r of runs) {
    if (r.status !== 'completed') continue
    let v: number | null = null
    if (key === 'total_trades') v = r.total_trades
    else if (key === 'win_rate') v = r.win_rate
    else if (key === 'avg_r') v = r.avg_r
    else if (key === 'total_pnl_gbp') v = r.total_pnl_gbp
    else if (key === 'sharpe_ratio') v = r.sharpe_ratio
    else if (key === 'max_drawdown_gbp')
      v = r.max_drawdown_gbp == null ? null : -Math.abs(r.max_drawdown_gbp)
    else if (key === 'expectancy_per_trade_gbp') v = r.expectancy_per_trade_gbp
    if (v == null || !Number.isFinite(v)) continue
    if (best === null || v > best.value) {
      best = { id: r.id, value: v }
    }
  }
  return best?.id ?? null
}

export function BatchLeaderboard({ runs }: BatchLeaderboardProps) {
  const [sortKey, setSortKey] = useState<SortKey>('total_pnl_gbp')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const sorted = useMemo(() => {
    const copy = [...runs]
    copy.sort((a, b) => {
      let av: number | string = 0
      let bv: number | string = 0
      if (sortKey === 'name') {
        av = a.name
        bv = b.name
      } else {
        av = (a[sortKey] as number | null) ?? -Infinity
        bv = (b[sortKey] as number | null) ?? -Infinity
      }
      if (av === bv) return 0
      const cmp = av < bv ? -1 : 1
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [runs, sortKey, sortDir])

  const bestByPnl = bestRunIdFor(runs, 'total_pnl_gbp')
  const bestByWin = bestRunIdFor(runs, 'win_rate')
  const bestByAvgR = bestRunIdFor(runs, 'avg_r')
  const bestBySharpe = bestRunIdFor(runs, 'sharpe_ratio')
  const bestByDd = bestRunIdFor(runs, 'max_drawdown_gbp')
  const bestByExp = bestRunIdFor(runs, 'expectancy_per_trade_gbp')

  function clickHeader(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-white/[0.06] bg-surface">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-white/45">
          <tr>
            <Th
              onClick={() => clickHeader('name')}
              active={sortKey === 'name'}
              dir={sortDir}
              align="left"
            >
              Strategy
            </Th>
            <th className="px-3 py-2 text-left">Status</th>
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
              onClick={() => clickHeader('sharpe_ratio')}
              active={sortKey === 'sharpe_ratio'}
              dir={sortDir}
              align="right"
            >
              Sharpe
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
              onClick={() => clickHeader('expectancy_per_trade_gbp')}
              active={sortKey === 'expectancy_per_trade_gbp'}
              dir={sortDir}
              align="right"
            >
              Expectancy
            </Th>
            <th className="px-3 py-2 text-right">Details</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const greyed = row.status !== 'completed'
            return (
              <tr
                key={row.id}
                className={twMerge(
                  'border-t border-white/[0.04]',
                  greyed ? 'text-white/40' : 'text-white/85',
                )}
              >
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{row.name}</span>
                    {row.strategy_definition_id ? (
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent">
                        composable
                      </span>
                    ) : (
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/55">
                        framework
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={twMerge(
                      'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
                      row.status === 'completed' &&
                        'bg-emerald-500/15 text-emerald-300',
                      row.status === 'failed' && 'bg-red-500/15 text-red-300',
                      (row.status === 'pending' || row.status === 'running') &&
                        'bg-amber-500/15 text-amber-300',
                      row.status === 'cancelled' && 'bg-white/10 text-white/45',
                    )}
                  >
                    {row.status}
                  </span>
                </td>
                <Cell highlight={false}>
                  <div className="inline-flex items-center justify-end gap-2">
                    <span>{row.total_trades ?? '—'}</span>
                    <ZeroSignalBadge row={row} />
                  </div>
                </Cell>
                <Cell highlight={row.id === bestByWin && !greyed}>
                  {formatPct(row.win_rate)}
                </Cell>
                <Cell highlight={row.id === bestByAvgR && !greyed}>
                  {formatNumber(row.avg_r)}
                </Cell>
                <Cell highlight={row.id === bestByPnl && !greyed}>
                  {formatGbp(row.total_pnl_gbp)}
                </Cell>
                <Cell highlight={row.id === bestBySharpe && !greyed}>
                  {formatNumber(row.sharpe_ratio)}
                </Cell>
                <Cell highlight={row.id === bestByDd && !greyed}>
                  {formatGbp(row.max_drawdown_gbp)}
                </Cell>
                <Cell highlight={row.id === bestByExp && !greyed}>
                  {formatGbp(row.expectancy_per_trade_gbp)}
                </Cell>
                <td className="px-3 py-2 text-right">
                  <Link
                    href={`/backtest/${row.id}`}
                    className="text-xs text-accent hover:underline"
                  >
                    View details
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
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

function Cell({
  children,
  highlight,
}: {
  children: React.ReactNode
  highlight: boolean
}) {
  return (
    <td
      className={twMerge(
        'px-3 py-2 text-right font-mono',
        highlight && 'font-semibold text-emerald-300',
      )}
    >
      {children}
    </td>
  )
}

// Flag for runs that completed without producing any trades. The
// summary copy is sourced from the engine's diagnostics ledger
// (BacktestDiagnostics) so the operator sees the bottleneck
// condition right in the leaderboard rather than having to click
// into every empty row to find out why.
function ZeroSignalBadge({
  row,
}: {
  row: BatchLeaderboardProps['runs'][number]
}) {
  const [open, setOpen] = useState(false)
  if (row.status !== 'completed') return null
  if ((row.total_trades ?? 0) > 0) return null

  const summary = row.diagnostics_summary
  const tooltipLines: string[] = []
  if (summary) {
    tooltipLines.push(
      `Evaluated ${summary.evaluations_total.toLocaleString('en-GB')} times.`,
    )
    if (summary.top_failure_type) {
      const insufficient = summary.top_failure_insufficient_data
        ? ' (insufficient candle history)'
        : ''
      tooltipLines.push(
        `Top blocker: ${summary.top_failure_type} · ${summary.top_failure_count.toLocaleString('en-GB')} failures${insufficient}.`,
      )
    }
    if (
      summary.warmup_param_max > summary.warmup_candles_used &&
      summary.warmup_param_max > 0
    ) {
      tooltipLines.push(
        `Warmup mismatch: needs ${summary.warmup_param_max} candles, engine used ${summary.warmup_candles_used}.`,
      )
    }
  } else {
    tooltipLines.push('No diagnostics available for this run.')
  }
  const tooltip = tooltipLines.join('\n')

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={tooltip}
        aria-label="No signals — show diagnostics"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-amber-400/50 bg-amber-500/15 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/25"
      >
        !
      </button>
      {open ? (
        <div className="absolute right-0 top-5 z-10 w-72 rounded-md border border-white/10 bg-bg p-3 text-left text-[11px] leading-snug text-white/80 shadow-lg">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-amber-300">
            Why no signals?
          </div>
          <ul className="space-y-1 whitespace-pre-line text-white/75">
            {tooltipLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <Link
            href={`/backtest/${row.id}`}
            className="mt-2 inline-block text-accent hover:underline"
          >
            Open full diagnostics →
          </Link>
        </div>
      ) : null}
    </span>
  )
}
