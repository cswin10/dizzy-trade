'use client'

import { useLogTradePanel } from './LogTradePanelContext'
import { Button } from '@/components/ui/Button'

export function LogTradeButton() {
  const { open } = useLogTradePanel()

  return (
    <Button type="button" onClick={() => open()} className="w-auto px-3">
      <PlusIcon />
      <span>Log trade</span>
    </Button>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3">
      <path
        d="M6 2 V10 M2 6 H10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
