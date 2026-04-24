'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { LogTradePanel, type LogTradePanelMode } from './LogTradePanel'

export type LogTradePrefill = {
  mode?: LogTradePanelMode
  trade_id?: string
  asset_symbol?: string
  coingecko_id?: string
  direction?: 'long' | 'short'
  entry_price?: number
  entry_size?: number
  venue?: string
  narrative_tag?: string
  setup_type?: string
  thesis?: string
  alert_id?: string
  framework_id?: string
  framework_name?: string
  suggested_stop?: number
  suggested_target?: number
}

type Ctx = {
  open: (prefill?: LogTradePrefill) => void
  close: () => void
}

const LogTradePanelContext = createContext<Ctx | null>(null)

export function useLogTradePanel(): Ctx {
  const ctx = useContext(LogTradePanelContext)
  if (!ctx) {
    throw new Error(
      'useLogTradePanel must be used within a LogTradePanelProvider',
    )
  }
  return ctx
}

export function LogTradePanelProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    open: boolean
    prefill?: LogTradePrefill
  }>({ open: false })

  const open = useCallback((prefill?: LogTradePrefill) => {
    setState({ open: true, prefill })
  }, [])

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, open: false }))
  }, [])

  const value = useMemo<Ctx>(() => ({ open, close }), [open, close])

  return (
    <LogTradePanelContext.Provider value={value}>
      {children}
      <LogTradePanel
        open={state.open}
        mode={state.prefill?.mode ?? 'create'}
        prefill={state.prefill}
        onClose={close}
      />
    </LogTradePanelContext.Provider>
  )
}
