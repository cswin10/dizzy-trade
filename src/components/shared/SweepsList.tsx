'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { twMerge } from 'tailwind-merge'

import { deleteSweepAction } from '@/app/actions/backtest-sweeps'

import { ConfirmDialog } from './ConfirmDialog'

export type SweepSummary = {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  framework_id: string | null
  timeframe: string
  pairs: string[]
  date_range_start: string
  date_range_end: string
  total_combinations: number
  combinations_completed: number
  combinations_failed: number
  created_at: string | null
}

const statusClass: Record<SweepSummary['status'], string> = {
  pending: 'bg-white/10 text-white/55',
  running: 'bg-amber-500/15 text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  failed: 'bg-red-500/15 text-red-300',
  cancelled: 'bg-white/10 text-white/45',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function SweepsList({ sweeps }: { sweeps: SweepSummary[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pendingDeleteSweep = pendingDeleteId
    ? (sweeps.find((s) => s.id === pendingDeleteId) ?? null)
    : null

  function confirmDelete() {
    if (!pendingDeleteId) return
    const id = pendingDeleteId
    setError(null)
    startTransition(async () => {
      const result = await deleteSweepAction(id)
      if (!result.ok) {
        setError(result.message ?? 'Failed to delete sweep')
        setPendingDeleteId(null)
        return
      }
      setPendingDeleteId(null)
      router.refresh()
    })
  }

  if (sweeps.length === 0) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-surface p-8 text-center">
        <p className="text-sm text-white/55">
          No sweeps yet. Create one to compare many parameter settings at once.
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
        {sweeps.map((sweep) => (
          <li
            key={sweep.id}
            className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-surface px-4 py-3 transition-colors duration-200 hover:border-white/10 hover:bg-surface-2"
          >
            <Link
              href={`/backtest/sweeps/${sweep.id}`}
              className="flex flex-1 flex-col gap-1"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white">
                  {sweep.name}
                </span>
                <span
                  className={twMerge(
                    'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
                    statusClass[sweep.status],
                  )}
                >
                  {sweep.status}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/45">
                <span>{sweep.framework_id}</span>
                <span>{sweep.timeframe}</span>
                <span>
                  {sweep.pairs.slice(0, 3).join(', ')}
                  {sweep.pairs.length > 3 ? ` +${sweep.pairs.length - 3}` : ''}
                </span>
                <span>
                  {formatDate(sweep.date_range_start)} to{' '}
                  {formatDate(sweep.date_range_end)}
                </span>
              </div>
            </Link>
            <div className="hidden items-center gap-6 text-xs text-white/65 sm:flex">
              <div className="flex flex-col items-end">
                <span className="text-[10px] uppercase tracking-wider text-white/35">
                  Combinations
                </span>
                <span className="font-mono text-xs text-white/85">
                  {sweep.combinations_completed}/{sweep.total_combinations}
                  {sweep.combinations_failed > 0
                    ? ` (${sweep.combinations_failed} failed)`
                    : ''}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPendingDeleteId(sweep.id)}
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
        title="Delete sweep?"
        message={
          pendingDeleteSweep
            ? `"${pendingDeleteSweep.name}" and all ${pendingDeleteSweep.total_combinations} of its underlying runs will be removed. This cannot be undone.`
            : 'This sweep and all its underlying runs will be removed. This cannot be undone.'
        }
        confirmLabel="Delete"
        destructive
        busy={isPending}
      />
    </>
  )
}
