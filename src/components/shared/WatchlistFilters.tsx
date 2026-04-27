'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useTransition } from 'react'

import { twMerge } from 'tailwind-merge'

import {
  FILTER_LABELS,
  FILTER_OPTIONS,
  SORT_LABELS,
  SORT_OPTIONS,
  parseFilter,
  parseSort,
  type FilterOption,
  type SortOption,
} from '@/lib/validations/watchlist'

const SORT_DISPLAY: Record<SortOption, string> = {
  readiness: 'Setup readiness',
  '24h': '24H change',
  volume: 'Volume',
  alpha: 'A→Z',
}

export function WatchlistFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  const sort = parseSort(params.get('sort') ?? undefined)
  const filter = parseFilter(params.get('filter') ?? undefined)

  const update = useCallback(
    (key: 'sort' | 'filter', value: SortOption | FilterOption | null) => {
      const next = new URLSearchParams(params.toString())
      if (
        value === null ||
        (key === 'sort' && value === 'readiness') ||
        (key === 'filter' && value === 'all')
      ) {
        next.delete(key)
      } else {
        next.set(key, value)
      }
      const qs = next.toString()
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname)
      })
    },
    [params, pathname, router],
  )

  return (
    <div
      className={twMerge(
        'flex flex-col gap-3 rounded-md border border-white/[0.06] bg-surface px-3 py-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-5 sm:gap-y-3 sm:px-4',
        pending && 'opacity-70',
      )}
    >
      <FilterColumn label="Sort">
        <ButtonGroup>
          {SORT_OPTIONS.map((option) => (
            <PillButton
              key={option}
              active={sort === option}
              onClick={() => update('sort', option)}
            >
              {SORT_DISPLAY[option]}
            </PillButton>
          ))}
        </ButtonGroup>
      </FilterColumn>
      <FilterColumn label="Show">
        <ButtonGroup>
          {FILTER_OPTIONS.map((option) => (
            <PillButton
              key={option}
              active={filter === option}
              onClick={() => update('filter', option)}
            >
              {FILTER_LABELS[option]}
            </PillButton>
          ))}
        </ButtonGroup>
      </FilterColumn>
      <span className="sr-only">{`Sort by ${SORT_LABELS[sort]}, show ${FILTER_LABELS[filter]}`}</span>
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
  return <div className="flex flex-wrap items-center gap-1.5">{children}</div>
}

function PillButton({
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
        active ? { boxShadow: '0 0 12px rgba(59,130,255,0.3)' } : undefined
      }
    >
      {children}
    </button>
  )
}
