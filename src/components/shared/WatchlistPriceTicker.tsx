'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import {
  getWatchlistPrices,
  type WatchlistPrice,
} from '@/app/actions/watchlist'

const REFRESH_MS = 30_000

export type LiveTick = {
  price: number
  volume_24h: number | null
  // change_24h_pct stays null on tick because we don't fetch candles
  // here; consumers should fall back to the server-rendered value.
  change_24h_pct: number | null
  // Wall-clock timestamp of the latest successful tick. Lets cards
  // animate on update without subscribing to the whole map.
  updated_at: number
}

type TickMap = Record<string, LiveTick>

const TickContext = createContext<TickMap>({})

/**
 * Polls getWatchlistPrices() every 30 seconds and exposes the latest
 * snapshot through context. Cards subscribe via useLivePrice(symbol)
 * and re-render only when their symbol's tick changes.
 */
export function WatchlistPriceTicker({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState<TickMap>({})

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      try {
        const prices = await getWatchlistPrices()
        if (cancelled) return
        const next: TickMap = {}
        const now = Date.now()
        for (const p of prices) {
          next[p.symbol] = {
            price: p.price,
            volume_24h: p.volume_24h,
            change_24h_pct: p.change_24h_pct,
            updated_at: now,
          }
        }
        setTick(next)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[watchlist ticker] poll failed: ${message}`)
      } finally {
        if (!cancelled) timer = setTimeout(poll, REFRESH_MS)
      }
    }

    timer = setTimeout(poll, REFRESH_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  return <TickContext.Provider value={tick}>{children}</TickContext.Provider>
}

export function useLivePrice(symbol: string): LiveTick | null {
  const ctx = useContext(TickContext)
  return ctx[symbol] ?? null
}

export function lookupPrice(map: TickMap, symbol: string): WatchlistPrice {
  const t = map[symbol]
  return {
    symbol,
    price: t?.price ?? 0,
    volume_24h: t?.volume_24h ?? null,
    change_24h_pct: t?.change_24h_pct ?? null,
  }
}
