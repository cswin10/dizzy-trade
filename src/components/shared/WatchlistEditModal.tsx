'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'

import { twMerge } from 'tailwind-merge'

import { updateWatchlist } from '@/app/actions/watchlist'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { WATCHLIST_MAX, WATCHLIST_MIN } from '@/lib/validations/watchlist'

export type WatchlistEditModalProps = {
  open: boolean
  onClose: () => void
  // Every active universe symbol, ordered alphabetically.
  universeSymbols: string[]
  // Symbols currently flagged is_watchlist=true.
  initialSelected: string[]
}

export function WatchlistEditModal({
  open,
  onClose,
  universeSymbols,
  initialSelected,
}: WatchlistEditModalProps) {
  const initialSet = useMemo(() => new Set(initialSelected), [initialSelected])
  const [selected, setSelected] = useState<Set<string>>(initialSet)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Reset state whenever the modal reopens so cancelled edits don't
  // persist across opens.
  useEffect(() => {
    if (open) {
      setSelected(new Set(initialSelected))
      setError(null)
    }
  }, [open, initialSelected])

  const toggle = (symbol: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(symbol)) next.delete(symbol)
      else next.add(symbol)
      return next
    })
    setError(null)
  }

  const submit = () => {
    const list = [...selected]
    if (list.length < WATCHLIST_MIN) {
      setError(`Pick at least ${WATCHLIST_MIN} pairs`)
      return
    }
    if (list.length > WATCHLIST_MAX) {
      setError(`Pick at most ${WATCHLIST_MAX} pairs`)
      return
    }
    startTransition(async () => {
      const result = await updateWatchlist(list)
      if (!result.ok) {
        setError(result.message)
        return
      }
      onClose()
    })
  }

  const count = selected.size
  const remaining = Math.max(0, WATCHLIST_MIN - count)
  const overflow = Math.max(0, count - WATCHLIST_MAX)
  const tone =
    overflow > 0
      ? 'text-negative'
      : remaining > 0
        ? 'text-warning'
        : 'text-positive'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit watchlist"
      description={`Pick ${WATCHLIST_MIN} to ${WATCHLIST_MAX} pairs to monitor on this page.`}
      className="max-w-lg"
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={pending}
            className="w-auto px-4"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || count < WATCHLIST_MIN || count > WATCHLIST_MAX}
            className="w-auto px-4"
          >
            {pending ? 'Saving' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-mono uppercase tracking-widest text-white/45">
            {count} selected
          </span>
          <span className={twMerge('font-mono tabular-nums', tone)}>
            {overflow > 0
              ? `${overflow} over limit`
              : remaining > 0
                ? `${remaining} more needed`
                : 'Within limits'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {universeSymbols.map((symbol) => {
            const checked = selected.has(symbol)
            return (
              <button
                key={symbol}
                type="button"
                onClick={() => toggle(symbol)}
                aria-pressed={checked}
                className={twMerge(
                  'flex items-center justify-between rounded-md border px-3 py-2 font-mono text-xs uppercase tracking-widest transition-colors duration-150',
                  checked
                    ? 'border-accent/50 bg-accent/15 text-white'
                    : 'border-white/10 text-white/65 hover:border-white/25 hover:text-white',
                )}
              >
                <span>{symbol}</span>
                <span
                  aria-hidden
                  className={twMerge(
                    'inline-flex h-3.5 w-3.5 items-center justify-center rounded border text-[10px]',
                    checked
                      ? 'border-accent bg-accent text-white'
                      : 'border-white/25 text-transparent',
                  )}
                >
                  ✓
                </span>
              </button>
            )
          })}
        </div>
        {error ? <p className="text-xs text-negative">{error}</p> : null}
      </div>
    </Dialog>
  )
}
