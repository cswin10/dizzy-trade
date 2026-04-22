'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'

import { deleteTradeAction } from '@/app/actions/trade'
import {
  initialTradeActionState,
  type TradeActionState,
} from '@/app/actions/trade-types'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { StatusDot } from '@/components/ui/StatusDot'
import type { Trade } from '@/lib/trade-helpers'

import { useEditLessonDialog } from './EditLessonDialogContext'
import { useLogTradePanel } from './LogTradePanelContext'

type Props = {
  trade: Trade
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-4 w-4">
      <circle cx="2" cy="6" r="1" fill="currentColor" />
      <circle cx="6" cy="6" r="1" fill="currentColor" />
      <circle cx="10" cy="6" r="1" fill="currentColor" />
    </svg>
  )
}

function DeleteSubmit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      disabled={pending}
      className="w-auto bg-negative px-4 text-white hover:bg-negative/90 disabled:bg-negative/40"
    >
      {pending ? (
        <>
          <StatusDot tone="negative" pulse />
          <span>Deleting</span>
        </>
      ) : (
        <span>{children}</span>
      )}
    </Button>
  )
}

export function TradeRowActions({ trade }: Props) {
  const { open: openPanel } = useLogTradePanel()
  const { openEditLesson } = useEditLessonDialog()
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const isOpen = trade.outcome === 'open'

  useEffect(() => {
    if (!menuOpen) return
    function onPointer(event: MouseEvent) {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const [deleteState, deleteAction] = useFormState<TradeActionState, FormData>(
    deleteTradeAction,
    initialTradeActionState,
  )

  useEffect(() => {
    if (deleteState.status === 'success') setConfirmDelete(false)
  }, [deleteState])

  return (
    <div
      ref={wrapperRef}
      className="relative"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setMenuOpen((p) => !p)
        }}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="rounded-md p-1.5 text-white/45 transition-colors duration-200 hover:bg-surface-2 hover:text-white"
      >
        <MoreIcon />
      </button>
      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 min-w-[160px] rounded-md border border-white/[0.06] bg-surface bg-panel-lit p-1"
        >
          {isOpen ? (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenuOpen(false)
                openPanel({
                  mode: 'close',
                  trade_id: trade.id,
                  asset_symbol: trade.asset_symbol,
                  direction: trade.direction,
                  entry_price: trade.entry_price,
                  entry_size: trade.entry_size,
                  venue: trade.venue,
                })
              }}
              className="block w-full rounded-md px-3 py-2 text-left text-sm text-white/70 transition-colors duration-200 hover:bg-surface-2 hover:text-white"
            >
              Close trade
            </button>
          ) : (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenuOpen(false)
                openEditLesson({
                  trade_id: trade.id,
                  asset_symbol: trade.asset_symbol,
                  lesson: trade.lesson,
                })
              }}
              className="block w-full rounded-md px-3 py-2 text-left text-sm text-white/70 transition-colors duration-200 hover:bg-surface-2 hover:text-white"
            >
              Edit lesson
            </button>
          )}
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setMenuOpen(false)
              setConfirmDelete(true)
            }}
            className="block w-full rounded-md px-3 py-2 text-left text-sm text-negative/90 transition-colors duration-200 hover:bg-surface-2 hover:text-negative"
          >
            Delete
          </button>
        </div>
      ) : null}

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this trade?"
        description="This cannot be undone."
        footer={
          <form action={deleteAction} className="flex items-center gap-3">
            <input type="hidden" name="trade_id" value={trade.id} />
            <Button
              type="button"
              variant="ghost"
              className="w-auto px-4"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
            <DeleteSubmit>Delete</DeleteSubmit>
          </form>
        }
      >
        {deleteState.status === 'error' ? (
          <p className="text-sm text-negative">{deleteState.message}</p>
        ) : null}
      </Dialog>
    </div>
  )
}
