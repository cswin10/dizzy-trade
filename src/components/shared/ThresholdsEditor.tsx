'use client'

import { useMemo, useState, useTransition } from 'react'

import { twMerge } from 'tailwind-merge'

import { updateThresholdAction } from '@/app/actions/settings'
import { Panel } from '@/components/ui/Panel'

export type ThresholdRow = {
  id: string
  framework_id: string
  key: string
  value: number
  description: string | null
  updated_at: string | null
}

const FRAMEWORK_ORDER = [
  'liquidation_hunt_v1',
  'narrative_breakout_v1',
  'mean_reversion_v1',
] as const

const FRAMEWORK_TITLES: Record<string, string> = {
  liquidation_hunt_v1: 'Liquidation hunt',
  narrative_breakout_v1: 'Narrative breakout',
  mean_reversion_v1: 'Mean reversion',
}

const relativeFormatter = new Intl.RelativeTimeFormat('en-GB', {
  numeric: 'auto',
})

function relativeUpdated(iso: string | null): string {
  if (!iso) return 'Never'
  const diffMs = Date.parse(iso) - Date.now()
  const abs = Math.abs(diffMs)
  if (!Number.isFinite(abs)) return 'Never'
  if (abs < 60_000)
    return relativeFormatter.format(Math.round(diffMs / 1_000), 'second')
  if (abs < 3_600_000)
    return relativeFormatter.format(Math.round(diffMs / 60_000), 'minute')
  if (abs < 86_400_000)
    return relativeFormatter.format(Math.round(diffMs / 3_600_000), 'hour')
  return relativeFormatter.format(Math.round(diffMs / 86_400_000), 'day')
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const abs = Math.abs(value)
  if (abs !== 0 && (abs < 0.001 || abs >= 1_000_000)) {
    return value.toExponential()
  }
  return String(value)
}

export type ThresholdsEditorProps = {
  initialThresholds: ThresholdRow[]
}

export function ThresholdsEditor({ initialThresholds }: ThresholdsEditorProps) {
  const [rows, setRows] = useState<ThresholdRow[]>(initialThresholds)

  const grouped = useMemo(() => {
    const map = new Map<string, ThresholdRow[]>()
    for (const row of rows) {
      const bucket = map.get(row.framework_id) ?? []
      bucket.push(row)
      map.set(row.framework_id, bucket)
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => a.key.localeCompare(b.key))
    }
    const ordered: { frameworkId: string; rows: ThresholdRow[] }[] = []
    for (const id of FRAMEWORK_ORDER) {
      const bucket = map.get(id)
      if (bucket) ordered.push({ frameworkId: id, rows: bucket })
      map.delete(id)
    }
    for (const [frameworkId, bucket] of map.entries()) {
      ordered.push({ frameworkId, rows: bucket })
    }
    return ordered
  }, [rows])

  const applyUpdate = (id: string, value: number) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, value, updated_at: new Date().toISOString() } : r,
      ),
    )
  }

  const revertUpdate = (original: ThresholdRow) => {
    setRows((prev) => prev.map((r) => (r.id === original.id ? original : r)))
  }

  return (
    <div className="flex flex-col gap-5">
      {grouped.map(({ frameworkId, rows: group }) => (
        <Panel
          key={frameworkId}
          title={FRAMEWORK_TITLES[frameworkId] ?? frameworkId}
        >
          <div className="overflow-hidden rounded-md border border-white/[0.04]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/[0.04] text-left text-[11px] font-medium uppercase tracking-wider text-white/45">
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Key</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2 text-right">Last updated</th>
                </tr>
              </thead>
              <tbody>
                {group.map((row) => (
                  <ThresholdRowEditor
                    key={row.id}
                    row={row}
                    onOptimisticUpdate={applyUpdate}
                    onRevert={revertUpdate}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-white/35">
            Changes apply on next scan (within 60 seconds).
          </p>
        </Panel>
      ))}
    </div>
  )
}

type ThresholdRowEditorProps = {
  row: ThresholdRow
  onOptimisticUpdate: (id: string, value: number) => void
  onRevert: (original: ThresholdRow) => void
}

function ThresholdRowEditor({
  row,
  onOptimisticUpdate,
  onRevert,
}: ThresholdRowEditorProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(row.value))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const startEdit = () => {
    setDraft(String(row.value))
    setError(null)
    setEditing(true)
  }

  const cancel = () => {
    setEditing(false)
    setError(null)
  }

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed.length === 0) {
      cancel()
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      setError('Not a number')
      return
    }
    if (parsed === row.value) {
      cancel()
      return
    }
    const original = row
    setEditing(false)
    setError(null)
    onOptimisticUpdate(row.id, parsed)
    startTransition(async () => {
      const result = await updateThresholdAction(
        row.framework_id,
        row.key,
        parsed,
      )
      if (!result.ok) {
        onRevert(original)
        setError(result.message ?? 'Update failed')
      }
    })
  }

  return (
    <tr className="border-t border-white/[0.04] first:border-t-0">
      <td className="px-3 py-2.5 align-top text-white/70">
        {row.description ?? ''}
      </td>
      <td className="px-3 py-2.5 align-top font-mono text-[12px] text-white/45">
        {row.key}
      </td>
      <td className="px-3 py-2.5 text-right align-top">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
            }}
            className="w-28 rounded border border-accent/40 bg-surface-2 px-2 py-1 text-right font-mono text-sm tabular-nums text-white outline-none focus:border-accent"
            inputMode="decimal"
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className={twMerge(
              'rounded px-2 py-1 font-mono text-sm tabular-nums transition-colors duration-150',
              pending
                ? 'text-white/40'
                : 'text-white hover:bg-surface-2 hover:text-white',
            )}
          >
            {formatValue(row.value)}
          </button>
        )}
        {error ? (
          <p className="mt-1 text-[11px] text-negative">{error}</p>
        ) : null}
      </td>
      <td className="px-3 py-2.5 text-right align-top text-xs text-white/40">
        {relativeUpdated(row.updated_at)}
      </td>
    </tr>
  )
}
