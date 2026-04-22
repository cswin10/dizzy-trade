'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

const MENU_WIDTH = 176

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
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [mounted, setMounted] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const isOpen = trade.outcome === 'open'

  useEffect(() => {
    setMounted(true)
  }, [])

  // Position the menu relative to the viewport and close on
  // outside-click, scroll, resize, or Escape. Portaling to body avoids
  // the parent table's overflow clip.
  useEffect(() => {
    if (!menuOpen) return
    function onPointer(event: MouseEvent) {
      const target = event.target as Node
      if (buttonRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    function onDismiss() {
      setMenuOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('resize', onDismiss)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('resize', onDismiss)
    }
  }, [menuOpen])

  const [deleteState, deleteAction] = useFormState<TradeActionState, FormData>(
    deleteTradeAction,
    initialTradeActionState,
  )

  useEffect(() => {
    if (deleteState.status === 'success') setConfirmDelete(false)
  }, [deleteState])

  const openMenu = () => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    // Anchor the right edge of the menu to the right edge of the button.
    const left = Math.max(8, rect.right - MENU_WIDTH)
    setMenuPos({ top: rect.bottom + 4, left })
    setMenuOpen(true)
  }

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (menuOpen) {
            setMenuOpen(false)
          } else {
            openMenu()
          }
        }}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="rounded-md p-1.5 text-white/45 transition-colors duration-200 hover:bg-surface-2 hover:text-white"
      >
        <MoreIcon />
      </button>

      {mounted && menuOpen && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{
                position: 'fixed',
                top: menuPos.top,
                left: menuPos.left,
                width: MENU_WIDTH,
              }}
              className="z-[55] rounded-md border border-white/[0.06] bg-surface bg-panel-lit p-1 shadow-xl"
              onClick={(e) => e.stopPropagation()}
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
            </div>,
            document.body,
          )
        : null}

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
