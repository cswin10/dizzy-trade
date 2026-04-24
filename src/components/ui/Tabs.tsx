'use client'

import { useState, type ReactNode } from 'react'

import { twMerge } from 'tailwind-merge'

export type TabItem = {
  id: string
  label: string
  content: ReactNode
}

export type TabsProps = {
  tabs: TabItem[]
  defaultTabId?: string
  className?: string
}

export function Tabs({ tabs, defaultTabId, className }: TabsProps) {
  const [active, setActive] = useState<string>(
    defaultTabId ?? tabs[0]?.id ?? '',
  )
  const current = tabs.find((t) => t.id === active) ?? tabs[0]

  return (
    <div className={className}>
      <div
        role="tablist"
        className="relative flex items-center gap-7 border-b border-white/[0.06]"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(tab.id)}
              className={twMerge(
                'relative -mb-px pb-3 pt-2 text-sm font-medium transition-colors duration-200',
                selected ? 'text-white' : 'text-white/55 hover:text-white',
              )}
            >
              {tab.label}
              {selected ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 -bottom-1 h-[2px] rounded-full bg-accent"
                />
              ) : null}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" className="pt-6">
        {current?.content}
      </div>
    </div>
  )
}
