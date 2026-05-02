'use client'

import { useMemo, useState } from 'react'

import { twMerge } from 'tailwind-merge'

import { Dialog } from '@/components/ui/Dialog'
import {
  CATEGORY_DISPLAY,
  CONDITION_DESCRIPTORS,
  type ConditionUIDescriptor,
} from '@/lib/strategies/condition-ui-descriptors'

export type ConditionPickerModalProps = {
  open: boolean
  onClose: () => void
  onPick: (descriptor: ConditionUIDescriptor) => void
}

// Two-pane picker. Left rail of categories, right pane of cards.
// Each card is a single condition with its title, short
// description and an Add button that hands the descriptor to the
// parent. The parent is responsible for instantiating the
// condition with the descriptor's default values.
export function ConditionPickerModal({
  open,
  onClose,
  onPick,
}: ConditionPickerModalProps) {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('momentum')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return CONDITION_DESCRIPTORS.filter((d) => {
      if (q.length > 0) {
        return (
          d.title.toLowerCase().includes(q) ||
          d.description.toLowerCase().includes(q) ||
          d.type.toLowerCase().includes(q)
        )
      }
      return d.category === activeCategory
    })
  }, [query, activeCategory])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add condition"
      description="Pick a condition to add to the current group."
      className="max-w-3xl"
    >
      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search conditions"
        className="mb-3 h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent"
      />
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <ul className="hidden flex-col gap-1 sm:flex">
          {CATEGORY_DISPLAY.map((cat) => (
            <li key={cat.category}>
              <button
                type="button"
                onClick={() => {
                  setActiveCategory(cat.category)
                  setQuery('')
                }}
                className={twMerge(
                  'w-full rounded-md px-3 py-1.5 text-left text-xs transition-colors',
                  activeCategory === cat.category && query.length === 0
                    ? 'bg-accent/15 text-white'
                    : 'text-white/55 hover:bg-surface-2 hover:text-white',
                )}
              >
                {cat.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:max-h-[420px] sm:overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="rounded-md border border-white/[0.06] bg-surface-2 p-4 text-sm text-white/55">
              No conditions match.
            </p>
          ) : null}
          {filtered.map((d) => (
            <div
              key={d.type}
              className="flex items-start justify-between gap-3 rounded-md border border-white/[0.06] bg-surface-2 p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">
                    {d.title}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-white/35">
                    {d.type}
                  </span>
                </div>
                <p className="mt-1 text-xs text-white/55">{d.description}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onPick(d)
                  onClose()
                }}
                className="rounded-md border border-accent/30 bg-accent/10 px-3 py-1 text-xs text-accent transition-colors hover:bg-accent/20"
              >
                Add
              </button>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
