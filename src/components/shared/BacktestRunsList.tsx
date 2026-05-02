'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { twMerge } from 'tailwind-merge'

import { deleteBacktestRunAction } from '@/app/actions/backtest'

import { ConfirmDialog } from './ConfirmDialog'

export type BacktestRunSummary = {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  framework_id: string
  timeframe: string
  pairs: string[]
  date_range_start: string
  date_range_end: string
  created_at: string | null
  total_trades: number | null
  win_rate: number | null
  total_pnl_gbp: number | null
  avg_r: number | null
  overfit_warning_triggered: boolean | null
}

const statusClass: Record<BacktestRunSummary['status'], string> = {
  pending: 'bg-white/10 text-white/55',
  running: 'bg-amber-500/15 text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  failed: 'bg-red-500/15 text-red-300',
  cancelled: 'bg-white/10 text-white/45',
}

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function BacktestRunsList({ runs }: { runs: BacktestRunSummary[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pendingDeleteRun = pendingDeleteId
    ? (runs.find((r) => r.id === pendingDeleteId) ?? null)
    : null

  function confirmDelete() {
    if (!pendingDeleteId) return
    const id = pendingDeleteId
    setError(null)
    startTransition(async () => {
      const result = await deleteBacktestRunAction(id)
      if (!result.ok) {
        setError(result.message ?? 'Failed to delete backtest')
        setPendingDeleteId(null)
        return
      }
      setPendingDeleteId(null)
      router.refresh()
    })
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-surface p-8 text-center">
        <p className="text-sm text-white/55">
          No backtests yet. Create your first to see how strategies would have
          performed historically.
        </p>
      </div>
    )
  }

  return (
    <>
      {error ? (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {runs.map((run) => (
          <li
            key={run.id}
            className="group flex items-center gap-3 rounded-lg border border-white/[0.06] bg-surface px-4 py-3 transition-colors duration-200 hover:border-white/10 hover:bg-surface-2"
          >
            <Link
              href={`/backtest/${run.id}`}
              className="flex flex-1 flex-col gap-1"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white">
                  {run.name}
                </span>
                <span
                  className={twMerge(
                    'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
                    statusClass[run.status],
                  )}
                >
                  {run.status}
                </span>
                {run.overfit_warning_triggered ? (
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-red-300">
                    overfit
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/45">
                <span>{run.framework_id}</span>
                <span>{run.timeframe}</span>
                <span>
                  {run.pairs.slice(0, 3).join(', ')}
                  {run.pairs.length > 3 ? ` +${run.pairs.length - 3}` : ''}
                </span>
                <span>
                  {formatDate(run.date_range_start)} to{' '}
                  {formatDate(run.date_range_end)}
                </span>
              </div>
            </Link>
            <div className="hidden items-center gap-6 text-xs text-white/65 sm:flex">
              <Stat
                label="Trades"
                value={run.total_trades?.toString() ?? '—'}
              />
              <Stat label="Win" value={formatPct(run.win_rate)} />
              <Stat label="Avg R" value={run.avg_r?.toFixed(2) ?? '—'} />
              <Stat label="PnL" value={formatGbp(run.total_pnl_gbp)} />
            </div>
            <button
              type="button"
              onClick={() => setPendingDeleteId(run.id)}
              disabled={isPending}
              className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/55 transition-colors duration-200 hover:border-red-500/40 hover:text-red-300 disabled:opacity-40"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={pendingDeleteId !== null}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={confirmDelete}
        title="Delete backtest?"
        message={
          pendingDeleteRun
            ? `"${pendingDeleteRun.name}" and its trades will be removed. This cannot be undone.`
            : 'This backtest and its trades will be removed. This cannot be undone.'
        }
        confirmLabel="Delete"
        destructive
        busy={isPending}
      />
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-[10px] uppercase tracking-wider text-white/35">
        {label}
      </span>
      <span className="font-mono text-xs text-white/85">{value}</span>
    </div>
  )
}
