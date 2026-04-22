'use client'

import { useEffect, useMemo, useState } from 'react'

import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'

import { AlertsList, type AlertRow } from './AlertsList'

export type AlertsListRealtimeProps = {
  initialAlerts: AlertRow[]
  showDismissed?: boolean
}

type AlertPayload = Database['public']['Tables']['alerts']['Row']

export function AlertsListRealtime({
  initialAlerts,
  showDismissed = false,
}: AlertsListRealtimeProps) {
  const [alerts, setAlerts] = useState<AlertRow[]>(initialAlerts)

  useEffect(() => {
    setAlerts(initialAlerts)
  }, [initialAlerts])

  useEffect(() => {
    const client = createClient()
    const channel = client
      .channel('alerts-all')
      .on<AlertPayload>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'alerts' },
        (event) => {
          setAlerts((current) => {
            if (event.eventType === 'INSERT') {
              const next = event.new as AlertRow
              if (current.some((a) => a.id === next.id)) return current
              return [next, ...current]
            }
            if (event.eventType === 'UPDATE') {
              const next = event.new as AlertRow
              return current.map((a) => (a.id === next.id ? next : a))
            }
            if (event.eventType === 'DELETE') {
              const old = event.old as Partial<AlertRow>
              if (!old.id) return current
              return current.filter((a) => a.id !== old.id)
            }
            return current
          })
        },
      )
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [])

  const visible = useMemo(
    () => (showDismissed ? alerts : alerts.filter((a) => !a.dismissed)),
    [alerts, showDismissed],
  )

  return <AlertsList alerts={visible} />
}
