'use client'

import { useMemo, useState, useTransition } from 'react'

import { twMerge } from 'tailwind-merge'

import { updateNarrativeTagAction } from '@/app/actions/settings'
import { Panel } from '@/components/ui/Panel'

export type HeatLevel = 'hot' | 'warm' | 'cool' | 'cold'

export type NarrativeTagRow = {
  symbol: string
  heat_level: HeatLevel
  note: string | null
  updated_at: string | null
  persisted: boolean
}

const HEATS: { id: HeatLevel; label: string; active: string }[] = [
  {
    id: 'hot',
    label: 'Hot',
    active: 'border-negative bg-negative/20 text-negative',
  },
  {
    id: 'warm',
    label: 'Warm',
    active: 'border-warning bg-warning/20 text-warning',
  },
  {
    id: 'cool',
    label: 'Cool',
    active: 'border-accent bg-accent/20 text-accent',
  },
  {
    id: 'cold',
    label: 'Cold',
    active: 'border-white/35 bg-white/10 text-white/70',
  },
]

export type NarrativeTagsEditorProps = {
  universeSymbols: string[]
  initialTags: NarrativeTagRow[]
}

export function NarrativeTagsEditor({
  universeSymbols,
  initialTags,
}: NarrativeTagsEditorProps) {
  const initialMap = useMemo(() => {
    const map = new Map<string, NarrativeTagRow>()
    for (const tag of initialTags) map.set(tag.symbol, tag)
    for (const symbol of universeSymbols) {
      if (!map.has(symbol)) {
        map.set(symbol, {
          symbol,
          heat_level: 'cool',
          note: null,
          updated_at: null,
          persisted: false,
        })
      }
    }
    return map
  }, [initialTags, universeSymbols])

  const [tags, setTags] = useState<Map<string, NarrativeTagRow>>(initialMap)

  const orderedSymbols = useMemo(
    () => [...universeSymbols].sort((a, b) => a.localeCompare(b)),
    [universeSymbols],
  )

  const update = (symbol: string, patch: Partial<NarrativeTagRow>) => {
    setTags((prev) => {
      const next = new Map(prev)
      const current = next.get(symbol)
      if (!current) return prev
      next.set(symbol, { ...current, ...patch })
      return next
    })
  }

  return (
    <Panel title="Narrative heat tags">
      <p className="mb-4 text-xs text-white/45">
        Tag assets with their current narrative temperature. This feeds
        Framework 1 until the news module ships.
      </p>
      <div className="flex flex-col divide-y divide-white/[0.04]">
        {orderedSymbols.map((symbol) => {
          const row = tags.get(symbol)
          if (!row) return null
          return (
            <NarrativeRow
              key={symbol}
              row={row}
              onChange={(patch) => update(symbol, patch)}
            />
          )
        })}
      </div>
    </Panel>
  )
}

type NarrativeRowProps = {
  row: NarrativeTagRow
  onChange: (patch: Partial<NarrativeTagRow>) => void
}

function NarrativeRow({ row, onChange }: NarrativeRowProps) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [noteDraft, setNoteDraft] = useState(row.note ?? '')

  const save = (heat: HeatLevel, note: string | null) => {
    const previous = { ...row }
    onChange({
      heat_level: heat,
      note,
      persisted: true,
      updated_at: new Date().toISOString(),
    })
    setError(null)
    startTransition(async () => {
      const result = await updateNarrativeTagAction(
        row.symbol,
        heat,
        note ?? undefined,
      )
      if (!result.ok) {
        onChange(previous)
        setError(result.message ?? 'Update failed')
      }
    })
  }

  return (
    <div className="grid grid-cols-[100px_1fr_1fr] items-center gap-4 py-3">
      <div className="text-sm font-semibold uppercase tracking-wide text-white">
        {row.symbol}
      </div>
      <div className="flex flex-wrap gap-2">
        {HEATS.map((heat) => {
          const selected = heat.id === row.heat_level && row.persisted
          return (
            <button
              key={heat.id}
              type="button"
              onClick={() => save(heat.id, row.note)}
              disabled={pending}
              aria-pressed={selected}
              className={twMerge(
                'rounded-md border px-3 py-1 text-xs font-medium transition-colors duration-150',
                selected
                  ? heat.active
                  : 'border-white/10 bg-transparent text-white/50 hover:border-white/20 hover:text-white',
              )}
            >
              {heat.label}
            </button>
          )
        })}
      </div>
      <div className="flex flex-col gap-1">
        <input
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={() => {
            const trimmed = noteDraft.trim()
            const next = trimmed.length === 0 ? null : trimmed
            if (next === (row.note ?? null)) return
            save(row.heat_level, next)
          }}
          placeholder="Note (optional)"
          className="rounded border border-white/10 bg-surface-2 px-2.5 py-1 text-xs text-white/80 placeholder-white/30 outline-none focus:border-accent/40"
        />
        {error ? <p className="text-[11px] text-negative">{error}</p> : null}
      </div>
    </div>
  )
}
