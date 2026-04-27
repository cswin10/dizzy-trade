'use client'

import { useState, type ReactNode } from 'react'

import { twMerge } from 'tailwind-merge'

type TabId = 'trades' | 'narratives' | 'digest'

type Tab = {
  id: TabId
  label: string
  empty: string
}

const TABS: readonly Tab[] = [
  { id: 'trades', label: 'Trades', empty: 'Nothing logged yet' },
  { id: 'narratives', label: 'Narratives', empty: 'Signals will appear here' },
  { id: 'digest', label: 'Digest', empty: 'First digest generates tomorrow' },
] as const

export type ActivityTabsProps = {
  trades?: ReactNode
  narratives?: ReactNode
  digest?: ReactNode
}

export function ActivityTabs({
  trades,
  narratives,
  digest,
}: ActivityTabsProps) {
  const [active, setActive] = useState<TabId>('trades')
  const current = TABS.find((t) => t.id === active) ?? TABS[0]!

  const slot =
    active === 'trades' ? trades : active === 'narratives' ? narratives : digest

  return (
    <div>
      <div
        role="tablist"
        className="-mx-1 flex items-center gap-5 overflow-x-auto border-b border-white/[0.04] px-1 pb-3 sm:gap-6"
      >
        {TABS.map((tab) => {
          const selected = tab.id === active
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(tab.id)}
              className={twMerge(
                'relative text-[11px] font-medium uppercase tracking-wider transition-colors duration-200',
                selected ? 'text-white' : 'text-white/45 hover:text-white/70',
              )}
            >
              {tab.label}
              {selected ? (
                <span
                  aria-hidden="true"
                  className="absolute -bottom-[13px] left-0 right-0 h-px bg-accent"
                />
              ) : null}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" className="min-h-[140px] pt-4">
        {slot ? (
          slot
        ) : (
          <p className="pt-6 text-center text-sm text-white/35">
            {current.empty}
          </p>
        )}
      </div>
    </div>
  )
}
