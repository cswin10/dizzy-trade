'use client'

import { useState } from 'react'

import { WatchlistEditModal } from './WatchlistEditModal'

export type WatchlistEditButtonProps = {
  universeSymbols: string[]
  initialSelected: string[]
}

export function WatchlistEditButton({
  universeSymbols,
  initialSelected,
}: WatchlistEditButtonProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/15 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-white transition-colors duration-150 hover:bg-accent/25"
        style={{ boxShadow: '0 0 12px rgba(59,130,255,0.25)' }}
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        Edit watchlist
      </button>
      <WatchlistEditModal
        open={open}
        onClose={() => setOpen(false)}
        universeSymbols={universeSymbols}
        initialSelected={initialSelected}
      />
    </>
  )
}
