'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'

import { twMerge } from 'tailwind-merge'

import { NARRATIVE_TAGS } from '@/lib/constants/trade'
import { DATE_RANGE_PRESETS } from '@/lib/validations/analytics'

export type AnalyticsFiltersBarProps = {
  universeSymbols: string[]
}

const DATE_PRESET_LABEL: Record<(typeof DATE_RANGE_PRESETS)[number], string> = {
  all: 'ALL',
  '7d': '7D',
  '30d': '30D',
  '90d': '90D',
}

const DIRECTION_OPTIONS = ['all', 'long', 'short'] as const
const OUTCOME_OPTIONS = ['all', 'win', 'loss', 'breakeven'] as const

const DIRECTION_TONE: Record<(typeof DIRECTION_OPTIONS)[number], string> = {
  all: 'border-accent bg-accent/15 text-white',
  long: 'border-positive bg-positive/15 text-positive',
  short: 'border-negative bg-negative/15 text-negative',
}

export function AnalyticsFiltersBar({
  universeSymbols,
}: AnalyticsFiltersBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString())
      mutate(next)
      const qs = next.toString()
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname)
      })
    },
    [params, pathname, router],
  )

  const range = (params.get('range') as keyof typeof DATE_PRESET_LABEL) ?? 'all'
  const direction = (params.get('direction') ?? 'all') as
    | 'all'
    | 'long'
    | 'short'
  const outcome = (params.get('outcome') ?? 'all') as
    | 'all'
    | 'win'
    | 'loss'
    | 'breakeven'
  const narrative = params.get('narrative') ?? 'all'
  const pairsParam = params.get('pairs') ?? ''
  const selectedPairs = pairsParam
    ? pairsParam
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : []

  return (
    <div
      className={twMerge(
        'flex flex-wrap items-end gap-x-5 gap-y-3 rounded-md border border-white/[0.06] bg-surface px-4 py-3',
        pending && 'opacity-70',
      )}
    >
      <FilterColumn label="Range">
        <ButtonGroup>
          {DATE_RANGE_PRESETS.map((preset) => (
            <RangeButton
              key={preset}
              active={range === preset}
              onClick={() =>
                update((next) => {
                  if (preset === 'all') next.delete('range')
                  else next.set('range', preset)
                })
              }
            >
              {DATE_PRESET_LABEL[preset]}
            </RangeButton>
          ))}
        </ButtonGroup>
      </FilterColumn>

      <FilterColumn label="Direction">
        <ButtonGroup>
          {DIRECTION_OPTIONS.map((opt) => {
            const active = direction === opt
            return (
              <button
                key={opt}
                type="button"
                onClick={() =>
                  update((next) => {
                    if (opt === 'all') next.delete('direction')
                    else next.set('direction', opt)
                  })
                }
                className={twMerge(
                  'rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-widest transition-colors duration-150',
                  active
                    ? DIRECTION_TONE[opt]
                    : 'border-white/10 text-white/55 hover:border-white/25 hover:text-white',
                )}
              >
                {opt}
              </button>
            )
          })}
        </ButtonGroup>
      </FilterColumn>

      <FilterColumn label="Outcome">
        <ButtonGroup>
          {OUTCOME_OPTIONS.map((opt) => {
            const active = outcome === opt
            return (
              <button
                key={opt}
                type="button"
                onClick={() =>
                  update((next) => {
                    if (opt === 'all') next.delete('outcome')
                    else next.set('outcome', opt)
                  })
                }
                className={twMerge(
                  'rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-widest transition-colors duration-150',
                  active
                    ? 'border-accent bg-accent/15 text-white'
                    : 'border-white/10 text-white/55 hover:border-white/25 hover:text-white',
                )}
              >
                {opt}
              </button>
            )
          })}
        </ButtonGroup>
      </FilterColumn>

      <FilterColumn label="Narrative">
        <select
          value={narrative}
          onChange={(e) =>
            update((next) => {
              if (e.target.value === 'all') next.delete('narrative')
              else next.set('narrative', e.target.value)
            })
          }
          className="h-8 rounded-md border border-white/10 bg-base px-2 font-mono text-[11px] uppercase tracking-wider text-white outline-none focus:border-accent"
        >
          <option value="all">ALL</option>
          {NARRATIVE_TAGS.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      </FilterColumn>

      <FilterColumn label="Pairs">
        <PairMultiselect
          options={universeSymbols}
          value={selectedPairs}
          onChange={(next) =>
            update((url) => {
              if (next.length === 0) url.delete('pairs')
              else url.set('pairs', next.join(','))
            })
          }
        />
      </FilterColumn>
    </div>
  )
}

function FilterColumn({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-widest text-white/40">
        {label}
      </span>
      <div>{children}</div>
    </div>
  )
}

function ButtonGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1.5">{children}</div>
}

function RangeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={twMerge(
        'rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-widest transition-colors duration-150',
        active
          ? 'border-accent bg-accent/15 text-white'
          : 'border-white/10 text-white/55 hover:border-white/25 hover:text-white',
      )}
      style={
        active ? { boxShadow: '0 0 12px rgba(59,130,255,0.35)' } : undefined
      }
    >
      {children}
    </button>
  )
}

function PairMultiselect({
  options,
  value,
  onChange,
}: {
  options: string[]
  value: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onPointer(event: MouseEvent) {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (sym: string) => {
    if (value.includes(sym)) onChange(value.filter((v) => v !== sym))
    else onChange([...value, sym])
  }

  const triggerLabel =
    value.length === 0
      ? 'ALL PAIRS'
      : value.length === 1
        ? value[0]!
        : `${value.length} PAIRS`

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={twMerge(
          'h-8 rounded-md border px-2.5 font-mono text-[11px] uppercase tracking-widest transition-colors duration-150',
          value.length > 0
            ? 'border-accent bg-accent/15 text-white'
            : 'border-white/10 text-white/55 hover:border-white/25 hover:text-white',
        )}
      >
        {triggerLabel}
      </button>
      {open ? (
        <div
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 max-h-72 w-48 overflow-y-auto rounded-md border border-white/[0.08] bg-base p-1 shadow-xl"
        >
          {value.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="block w-full rounded px-2 py-1 text-left font-mono text-[11px] uppercase tracking-widest text-white/45 hover:bg-white/5 hover:text-white"
            >
              Clear selection
            </button>
          ) : null}
          {options.map((sym) => {
            const checked = value.includes(sym)
            return (
              <button
                key={sym}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => toggle(sym)}
                className={twMerge(
                  'flex w-full items-center justify-between rounded px-2 py-1 font-mono text-[11px] uppercase tracking-widest transition-colors duration-150',
                  checked
                    ? 'bg-accent/15 text-white'
                    : 'text-white/65 hover:bg-white/5 hover:text-white',
                )}
              >
                <span>{sym}</span>
                {checked ? (
                  <span aria-hidden className="text-accent">
                    ✓
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
