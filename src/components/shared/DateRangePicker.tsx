'use client'

import { useEffect, useRef, useState } from 'react'

import { twMerge } from 'tailwind-merge'

export type DateRange = { from: string; to: string }

export type DateRangePickerProps = {
  open: boolean
  initial: DateRange | null
  onApply: (range: DateRange) => void
  onCancel: () => void
}

type Preset = {
  label: string
  build: (now: Date) => DateRange
}

function ymd(d: Date): string {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function startOfWeek(d: Date): Date {
  // ISO week starts on Monday. UTC throughout to match the rest of
  // the analytics pipeline.
  const out = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  )
  const day = out.getUTCDay()
  const offset = day === 0 ? 6 : day - 1
  out.setUTCDate(out.getUTCDate() - offset)
  return out
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getUTCMonth() / 3) * 3
  return new Date(Date.UTC(d.getUTCFullYear(), q, 1))
}

function endOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function buildPresets(): Preset[] {
  return [
    {
      label: 'This week',
      build: (now) => ({ from: ymd(startOfWeek(now)), to: ymd(now) }),
    },
    {
      label: 'Last week',
      build: (now) => {
        const startThis = startOfWeek(now)
        const endLast = new Date(startThis)
        endLast.setUTCDate(endLast.getUTCDate() - 1)
        const startLast = startOfWeek(endLast)
        return { from: ymd(startLast), to: ymd(endLast) }
      },
    },
    {
      label: 'This month',
      build: (now) => ({ from: ymd(startOfMonth(now)), to: ymd(now) }),
    },
    {
      label: 'Last month',
      build: (now) => {
        const startThis = startOfMonth(now)
        const endLast = new Date(startThis)
        endLast.setUTCDate(endLast.getUTCDate() - 1)
        const startLast = startOfMonth(endLast)
        return { from: ymd(startLast), to: ymd(endLast) }
      },
    },
    {
      label: 'This quarter',
      build: (now) => ({ from: ymd(startOfQuarter(now)), to: ymd(now) }),
    },
  ]
}

export function DateRangePicker({
  open,
  initial,
  onApply,
  onCancel,
}: DateRangePickerProps) {
  const [from, setFrom] = useState<string>(initial?.from ?? '')
  const [to, setTo] = useState<string>(initial?.to ?? '')
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    setFrom(initial?.from ?? ymd(startOfWeek(new Date())))
    setTo(initial?.to ?? ymd(endOfDay(new Date())))
  }, [open, initial])

  useEffect(() => {
    if (!open) return
    function onPointer(event: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(event.target as Node)) onCancel()
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onCancel])

  if (!open) return null

  const presets = buildPresets()
  const apply = () => {
    if (!from || !to) return
    if (from > to) return
    onApply({ from, to })
  }

  return (
    <>
      <div
        aria-hidden
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm sm:hidden"
        onClick={onCancel}
      />
      <div
        ref={ref}
        className="fixed inset-x-4 top-1/2 z-50 max-h-[calc(100vh-2rem)] max-w-sm -translate-y-1/2 overflow-y-auto rounded-md border border-white/[0.08] bg-base p-3 shadow-xl sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-72 sm:max-w-none sm:translate-y-0 sm:overflow-visible"
      >
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-widest text-white/45">
              <span>From</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 rounded-md border border-white/10 bg-surface px-2 font-mono text-xs text-white outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-widest text-white/45">
              <span>To</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 rounded-md border border-white/10 bg-surface px-2 font-mono text-xs text-white outline-none focus:border-accent"
              />
            </label>
          </div>
          <div className="flex flex-col gap-1.5 pt-1">
            <span className="text-[10px] uppercase tracking-widest text-white/35">
              Quick presets
            </span>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    const range = p.build(new Date())
                    setFrom(range.from)
                    setTo(range.to)
                  }}
                  className={twMerge(
                    'rounded border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-white/55 transition-colors duration-150',
                    'hover:border-accent/40 hover:text-white',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-1 flex items-center justify-end gap-2 border-t border-white/[0.06] pt-2.5">
            <button
              type="button"
              onClick={onCancel}
              className="rounded px-2 py-1 font-mono text-[11px] uppercase tracking-widest text-white/55 transition-colors duration-150 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={!from || !to || from > to}
              className={twMerge(
                'rounded border border-accent bg-accent/15 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-white transition-colors duration-150',
                'disabled:cursor-not-allowed disabled:opacity-40',
              )}
              style={{ boxShadow: '0 0 12px rgba(59,130,255,0.3)' }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
