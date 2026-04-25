'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { twMerge } from 'tailwind-merge'

export type DialogProps = {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  className?: string
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  // Mount a client-side flag so SSR never tries to portal to a body that
  // does not exist yet.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open || !mounted) return null

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4"
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={twMerge(
          'relative max-h-[calc(100vh-1.5rem)] w-full max-w-md overflow-y-auto rounded-lg border border-white/[0.06] bg-surface bg-panel-lit p-4 shadow-xl sm:max-h-[calc(100vh-2rem)] sm:p-6',
          className,
        )}
      >
        {title ? (
          <h2 className="text-base font-medium tracking-tight text-white">
            {title}
          </h2>
        ) : null}
        {description ? (
          <p className="mt-2 text-sm text-white/55">{description}</p>
        ) : null}
        {children ? <div className="mt-4">{children}</div> : null}
        {footer ? (
          <div className="mt-6 flex items-center justify-end gap-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )

  // Portal to body so the dialog escapes every containing stacking
  // context and overflow clip in the ancestor tree.
  return createPortal(content, document.body)
}
