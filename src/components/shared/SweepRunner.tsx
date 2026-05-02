'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { twMerge } from 'tailwind-merge'

import {
  cancelSweepAction,
  processNextSweepBatchAction,
} from '@/app/actions/backtest-sweeps'

const POLL_INTERVAL_MS = 3000
const BATCH_SIZE = 5

export type SweepRunnerProps = {
  sweepId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  combinationsCompleted: number
  combinationsFailed: number
  totalCombinations: number
  runStartedAt: string | null
}

function formatEta(remaining: number, msPerComplete: number): string {
  if (!Number.isFinite(msPerComplete) || msPerComplete <= 0) return '—'
  const totalMs = remaining * msPerComplete
  const minutes = Math.round(totalMs / 60000)
  if (minutes <= 0) return 'less than a minute'
  if (minutes === 1) return 'about 1 minute'
  return `about ${minutes} minutes`
}

export function SweepRunner({
  sweepId,
  status,
  combinationsCompleted,
  combinationsFailed,
  totalCombinations,
  runStartedAt,
}: SweepRunnerProps) {
  const router = useRouter()
  const inFlight = useRef(false)
  const [cancelling, setCancelling] = useState(false)

  const isActive = status === 'pending' || status === 'running'
  const remaining =
    totalCombinations - (combinationsCompleted + combinationsFailed)

  // Drive the orchestrator from the client. One batch in flight at
  // a time; refresh the page on each batch completion so the server
  // component re-reads and rerenders the progress bar plus any newly
  // completed runs in the table.
  useEffect(() => {
    if (!isActive) return
    if (remaining <= 0) return

    const tick = async () => {
      if (inFlight.current) return
      inFlight.current = true
      try {
        await processNextSweepBatchAction(sweepId, BATCH_SIZE)
        router.refresh()
      } catch {
        // Errors surface on the server side and end up in the
        // sweep's error_message column; the next poll will pick
        // them up.
      } finally {
        inFlight.current = false
      }
    }

    void tick()
    const interval = setInterval(() => {
      router.refresh()
      void tick()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [sweepId, isActive, remaining, router])

  async function handleCancel() {
    if (!confirm('Cancel this sweep? Pending combinations will not run.'))
      return
    setCancelling(true)
    try {
      await cancelSweepAction(sweepId)
      router.refresh()
    } finally {
      setCancelling(false)
    }
  }

  const progressPct =
    totalCombinations > 0
      ? Math.round(
          ((combinationsCompleted + combinationsFailed) / totalCombinations) *
            100,
        )
      : 0

  let etaText = '—'
  if (
    isActive &&
    runStartedAt &&
    combinationsCompleted + combinationsFailed > 0 &&
    remaining > 0
  ) {
    const elapsedMs = Date.now() - new Date(runStartedAt).getTime()
    const msPerComplete =
      elapsedMs / (combinationsCompleted + combinationsFailed)
    etaText = formatEta(remaining, msPerComplete)
  }

  return (
    <div className="rounded-lg border border-white/[0.06] bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-white/85">
          {combinationsCompleted + combinationsFailed} of {totalCombinations}{' '}
          complete
          {combinationsFailed > 0 ? (
            <span className="ml-2 text-red-300">
              ({combinationsFailed} failed)
            </span>
          ) : null}
          {isActive && remaining > 0 ? (
            <span className="ml-3 text-white/45">~{etaText} remaining</span>
          ) : null}
        </div>
        {isActive ? (
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            className="rounded-md border border-white/10 px-3 py-1 text-xs text-white/65 transition-colors hover:border-red-500/40 hover:text-red-300 disabled:opacity-40"
          >
            {cancelling ? 'Cancelling…' : 'Cancel sweep'}
          </button>
        ) : null}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={twMerge(
            'h-full transition-all duration-500',
            status === 'failed'
              ? 'bg-red-400'
              : status === 'cancelled'
                ? 'bg-white/30'
                : status === 'completed'
                  ? 'bg-emerald-400'
                  : 'bg-accent',
          )}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  )
}
