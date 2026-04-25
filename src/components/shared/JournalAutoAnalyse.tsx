'use client'

import { useEffect, useRef } from 'react'

import { generateTradeAnalysisAction } from '@/app/actions/analysis'

export type JournalAutoAnalyseProps = {
  tradeIds: string[]
}

const TICK_MS = 1000

/**
 * Background trigger that fires Claude analyses for closed trades that
 * never received one. Walks the queue at one trade per second so the
 * tenant-side daily and concurrency caps in the action layer never
 * trip from this loop alone.
 *
 * Each browser tab tracks which ids it has already kicked off in this
 * session via a ref. The action itself short-circuits on already-
 * analysed trades, so duplicate triggers across tabs are harmless.
 */
export function JournalAutoAnalyse({ tradeIds }: JournalAutoAnalyseProps) {
  const queueRef = useRef<string[]>([])
  const startedRef = useRef<Set<string>>(new Set())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    queueRef.current = tradeIds.filter((id) => !startedRef.current.has(id))
  }, [tradeIds])

  useEffect(() => {
    let cancelled = false

    const tick = () => {
      if (cancelled) return
      const next = queueRef.current.shift()
      if (!next) {
        timerRef.current = setTimeout(tick, TICK_MS)
        return
      }
      startedRef.current.add(next)
      void generateTradeAnalysisAction(next, false).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[journal auto-analyse] ${next}: ${message}`)
      })
      timerRef.current = setTimeout(tick, TICK_MS)
    }

    timerRef.current = setTimeout(tick, TICK_MS)

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return null
}
