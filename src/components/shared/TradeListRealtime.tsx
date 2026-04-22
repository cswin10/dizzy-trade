'use client'

import { useEffect, useMemo, useState } from 'react'

import { createClient } from '@/lib/supabase/client'
import { subscribeToTrades } from '@/lib/supabase/realtime'
import type { Trade } from '@/lib/trade-helpers'

import { TradeList } from './TradeList'

export type TradeListRealtimeProps = {
  initialTrades: Trade[]
  tenantId: string
  variant?: 'full' | 'compact'
  limit?: number
}

export function TradeListRealtime({
  initialTrades,
  tenantId,
  variant = 'full',
  limit,
}: TradeListRealtimeProps) {
  const [trades, setTrades] = useState<Trade[]>(initialTrades)

  // Reset when the server-rendered prop changes (e.g. filter applied).
  useEffect(() => {
    setTrades(initialTrades)
  }, [initialTrades])

  useEffect(() => {
    if (!tenantId) return
    const client = createClient()
    const channel = subscribeToTrades(client, tenantId, (event) => {
      setTrades((current) => {
        if (event.eventType === 'INSERT') {
          const next = event.new as Trade
          if (current.some((t) => t.id === next.id)) return current
          return [next, ...current]
        }
        if (event.eventType === 'UPDATE') {
          const next = event.new as Trade
          return current.map((t) => (t.id === next.id ? next : t))
        }
        if (event.eventType === 'DELETE') {
          const old = event.old as Partial<Trade>
          if (!old.id) return current
          return current.filter((t) => t.id !== old.id)
        }
        return current
      })
    })

    return () => {
      void client.removeChannel(channel)
    }
  }, [tenantId])

  const visible = useMemo(
    () => (limit ? trades.slice(0, limit) : trades),
    [trades, limit],
  )

  return <TradeList trades={visible} variant={variant} />
}
