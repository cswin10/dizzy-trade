'use client'

import { useState } from 'react'

export type StrategyVersionHistoryRow = {
  id: string
  version_n: number
  name: string
  description: string | null
  schema_version: number
  change_note: string | null
  created_at: string
  definition: Record<string, unknown>
}

export type StrategyVersionHistoryProps = {
  versions: StrategyVersionHistoryRow[]
  currentVersion: number
}

function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function StrategyVersionHistory({
  versions,
  currentVersion,
}: StrategyVersionHistoryProps) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (versions.length === 0) {
    return (
      <p className="text-xs text-white/55">
        No version history yet. The first version is written automatically when
        a strategy is created; subsequent edits to the JSON document add a new
        row here.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {versions.map((v) => {
        const isCurrent = v.version_n === currentVersion
        const isOpen = expanded === v.id
        return (
          <li
            key={v.id}
            className="rounded-md border border-white/[0.06] bg-surface-2"
          >
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : v.id)}
              className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left"
            >
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-white">
                    v{v.version_n}
                  </span>
                  {isCurrent ? (
                    <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                      Current
                    </span>
                  ) : null}
                  <span className="text-xs text-white/55">
                    {formatStamp(v.created_at)}
                  </span>
                </div>
                {v.change_note ? (
                  <p className="text-xs text-white/65">{v.change_note}</p>
                ) : (
                  <p className="text-[11px] italic text-white/35">
                    No change note
                  </p>
                )}
              </div>
              <span className="text-[11px] text-white/45">
                {isOpen ? 'Hide' : 'Show'} JSON
              </span>
            </button>
            {isOpen ? (
              <pre className="overflow-x-auto border-t border-white/[0.06] px-3 py-2 font-mono text-[11px] text-white/65">
                {JSON.stringify(v.definition, null, 2)}
              </pre>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
