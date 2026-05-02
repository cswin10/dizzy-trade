'use client'

import { type ReactNode } from 'react'

import { twMerge } from 'tailwind-merge'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'

export type ConfirmDialogProps = {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
}

// Drop-in replacement for window.confirm. Uses the existing Dialog
// portal so it inherits the dark theme, escape-to-close, and click-
// outside-to-cancel behaviour. The destructive variant tints the
// confirm button red so a delete or cancel reads at a glance as
// something the user has to commit to.
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            className="w-auto"
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            className={twMerge(
              'w-auto',
              destructive
                ? 'bg-red-500/90 hover:bg-red-500 disabled:bg-red-500/40'
                : '',
            )}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-white/70">{message}</p>
    </Dialog>
  )
}
