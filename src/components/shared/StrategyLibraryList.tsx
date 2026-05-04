'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'

import { twMerge } from 'tailwind-merge'

import {
  activateStrategyDefinitionAction,
  archiveStrategyDefinitionAction,
  deactivateStrategyDefinitionAction,
  deleteStrategyDefinitionAction,
  type StrategyLibraryRow,
} from '@/app/actions/strategy-definitions'
import { toggleStrategyActiveAction } from '@/app/actions/strategies'

import { BatchSelectActionBar } from './BatchSelectActionBar'
import { ConfirmDialog } from './ConfirmDialog'

export type StrategyLibraryListProps = {
  rows: StrategyLibraryRow[]
}

type Filter = 'all' | 'composable' | 'framework' | 'active' | 'archived'

const FILTER_OPTIONS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'composable', label: 'Composable only' },
  { value: 'framework', label: 'Framework only' },
  { value: 'active', label: 'Active only' },
  { value: 'archived', label: 'Archived' },
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function StrategyLibraryList({ rows }: StrategyLibraryListProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [filter, setFilter] = useState<Filter>('all')
  const [error, setError] = useState<string | null>(null)
  const [pendingActivate, setPendingActivate] =
    useState<StrategyLibraryRow | null>(null)
  const [pendingDelete, setPendingDelete] = useState<StrategyLibraryRow | null>(
    null,
  )
  // Select mode renders a checkbox per row and a sticky action
  // bar at the bottom of the viewport. With one or more rows
  // ticked the bar offers bulk Archive / Delete (composable only,
  // matching the per-row controls); with two or more it also
  // offers Run batch backtest. The /backtest/batch/new link
  // receives the selection via query params.
  const [compareMode, setCompareMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false)
  const [pendingBulkArchive, setPendingBulkArchive] = useState(false)

  function toggleRowSelected(row: StrategyLibraryRow) {
    const key = `${row.source}:${row.id}`
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const selectedComposable = Array.from(selected)
    .filter((k) => k.startsWith('composable:'))
    .map((k) => k.slice('composable:'.length))
  const selectedLegacy = Array.from(selected)
    .filter((k) => k.startsWith('framework:'))
    .map((k) => k.slice('framework:'.length))

  const currentlyActive = useMemo(
    () => rows.find((row) => row.is_active) ?? null,
    [rows],
  )

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (filter === 'composable' && row.source !== 'composable') return false
      if (filter === 'framework' && row.source !== 'framework') return false
      if (filter === 'active' && !row.is_active) return false
      if (filter === 'archived') {
        return row.source === 'composable' && row.is_archived
      }
      // For non-archived filters, hide archived composable rows.
      if (row.source === 'composable' && row.is_archived) return false
      return true
    })
  }, [rows, filter])

  function performActivate(row: StrategyLibraryRow) {
    setError(null)
    startTransition(async () => {
      const result =
        row.source === 'composable'
          ? await activateStrategyDefinitionAction(row.id)
          : await toggleStrategyActiveAction(row.id, true)
      if (!result.ok) {
        setError(result.message ?? 'Activation failed')
        setPendingActivate(null)
        return
      }
      setPendingActivate(null)
      router.refresh()
    })
  }

  function performDeactivate(row: StrategyLibraryRow) {
    setError(null)
    startTransition(async () => {
      const result =
        row.source === 'composable'
          ? await deactivateStrategyDefinitionAction(row.id)
          : await toggleStrategyActiveAction(row.id, false)
      if (!result.ok) {
        setError(result.message ?? 'Deactivation failed')
        return
      }
      router.refresh()
    })
  }

  function performDelete(row: StrategyLibraryRow) {
    setError(null)
    startTransition(async () => {
      if (row.source !== 'composable') {
        setError('Use the legacy strategies editor to delete framework rows.')
        setPendingDelete(null)
        return
      }
      const result = await deleteStrategyDefinitionAction(row.id)
      if (!result.ok) {
        setError(result.message ?? 'Delete failed')
        setPendingDelete(null)
        return
      }
      setPendingDelete(null)
      router.refresh()
    })
  }

  function performArchive(row: StrategyLibraryRow) {
    setError(null)
    startTransition(async () => {
      if (row.source !== 'composable') return
      const result = await archiveStrategyDefinitionAction(row.id)
      if (!result.ok) {
        setError(result.message ?? 'Archive failed')
        return
      }
      router.refresh()
    })
  }

  function performBulkDelete() {
    setError(null)
    const ids = [...selectedComposable]
    if (ids.length === 0) {
      setPendingBulkDelete(false)
      return
    }
    startTransition(async () => {
      const failures: string[] = []
      for (const id of ids) {
        const result = await deleteStrategyDefinitionAction(id)
        if (!result.ok) failures.push(result.message ?? id)
      }
      setPendingBulkDelete(false)
      setSelected(new Set())
      if (failures.length > 0) {
        setError(
          `Deleted ${ids.length - failures.length} of ${ids.length}. ${failures.length} failed: ${failures[0]}`,
        )
      }
      router.refresh()
    })
  }

  function performBulkArchive() {
    setError(null)
    const ids = [...selectedComposable]
    if (ids.length === 0) {
      setPendingBulkArchive(false)
      return
    }
    startTransition(async () => {
      const failures: string[] = []
      for (const id of ids) {
        const result = await archiveStrategyDefinitionAction(id)
        if (!result.ok) failures.push(result.message ?? id)
      }
      setPendingBulkArchive(false)
      setSelected(new Set())
      if (failures.length > 0) {
        setError(
          `Archived ${ids.length - failures.length} of ${ids.length}. ${failures.length} failed: ${failures[0]}`,
        )
      }
      router.refresh()
    })
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-surface p-10 text-center">
        <p className="text-sm text-white/65">
          No strategies yet. Build one with the visual builder, or paste a JSON
          definition you already have.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link
            href="/settings/strategies/new"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            Build your first strategy
          </Link>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilter(option.value)}
            className={twMerge(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              filter === option.value
                ? 'border-accent bg-accent/15 text-white'
                : 'border-white/10 text-white/55 hover:border-white/20 hover:text-white',
            )}
          >
            {option.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-white/45">
          {filtered.length} of {rows.length}
        </span>
        <button
          type="button"
          onClick={() => {
            setCompareMode((v) => !v)
            setSelected(new Set())
          }}
          className={twMerge(
            'rounded-full border px-3 py-1 text-xs transition-colors',
            compareMode
              ? 'border-accent bg-accent/15 text-white'
              : 'border-white/10 text-white/55 hover:border-white/20 hover:text-white',
          )}
        >
          {compareMode ? 'Exit select mode' : 'Select'}
        </button>
        {compareMode ? (
          <button
            type="button"
            onClick={() => {
              // Toggle: if every selectable visible row is already
              // ticked, clear; otherwise select all of them. Archived
              // rows stay disabled, mirroring the per-row checkbox.
              const selectable = filtered.filter((r) => !r.is_archived)
              const allTicked =
                selectable.length > 0 &&
                selectable.every((r) =>
                  selected.has(`${r.source}:${r.id}`),
                )
              if (allTicked) {
                setSelected(new Set())
              } else {
                setSelected(
                  new Set(selectable.map((r) => `${r.source}:${r.id}`)),
                )
              }
            }}
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/55 transition-colors hover:border-white/20 hover:text-white"
          >
            {filtered
              .filter((r) => !r.is_archived)
              .every((r) => selected.has(`${r.source}:${r.id}`)) &&
            filtered.filter((r) => !r.is_archived).length > 0
              ? 'Clear selection'
              : 'Select all'}
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <ul className={twMerge('flex flex-col gap-2', compareMode && 'pb-20')}>
        {filtered.map((row) => (
          <li
            key={`${row.source}:${row.id}`}
            className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-surface px-4 py-3 transition-colors hover:border-white/10 hover:bg-surface-2"
          >
            {compareMode ? (
              <input
                type="checkbox"
                aria-label={`Select ${row.name}`}
                checked={selected.has(`${row.source}:${row.id}`)}
                onChange={() => toggleRowSelected(row)}
                disabled={row.is_archived}
              />
            ) : null}
            <Link
              href={
                row.source === 'composable'
                  ? `/settings/strategies/${row.id}`
                  : `/settings`
              }
              className="flex flex-1 flex-col gap-1"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white">
                  {row.name}
                </span>
                <span
                  className={twMerge(
                    'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
                    row.source === 'composable'
                      ? 'bg-accent/15 text-accent'
                      : 'bg-white/10 text-white/55',
                  )}
                >
                  {row.source === 'composable' ? 'composable' : 'framework'}
                </span>
                {row.is_active ? (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                    active
                  </span>
                ) : null}
                {row.is_archived ? (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/45">
                    archived
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/45">
                <span>{row.timeframe}</span>
                <span>
                  {row.pairs.slice(0, 4).join(', ')}
                  {row.pairs.length > 4 ? ` +${row.pairs.length - 4}` : ''}
                </span>
                <span>Updated {formatDate(row.updated_at)}</span>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              {row.is_active ? (
                <button
                  type="button"
                  onClick={() => performDeactivate(row)}
                  disabled={isPending}
                  className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
                >
                  Deactivate
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setPendingActivate(row)}
                  disabled={isPending || row.is_archived}
                  className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/65 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40"
                >
                  Activate
                </button>
              )}
              {row.source === 'composable' ? (
                <Link
                  href={`/settings/strategies/${row.id}/edit`}
                  className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/65 hover:border-white/25 hover:text-white"
                >
                  Edit
                </Link>
              ) : null}
              {row.source === 'composable' && !row.is_archived ? (
                <button
                  type="button"
                  onClick={() => performArchive(row)}
                  disabled={isPending}
                  className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/55 transition-colors hover:border-white/25 hover:text-white disabled:opacity-40"
                >
                  Archive
                </button>
              ) : null}
              {row.source === 'composable' ? (
                <button
                  type="button"
                  onClick={() => setPendingDelete(row)}
                  disabled={isPending}
                  className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/55 transition-colors hover:border-red-500/40 hover:text-red-300 disabled:opacity-40"
                >
                  Delete
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {compareMode ? (
        <BatchSelectActionBar
          selectedComposable={selectedComposable}
          selectedLegacy={selectedLegacy}
          onClear={() => setSelected(new Set())}
          onBulkArchive={() => setPendingBulkArchive(true)}
          onBulkDelete={() => setPendingBulkDelete(true)}
          busy={isPending}
        />
      ) : null}

      <ConfirmDialog
        open={pendingActivate !== null}
        onClose={() => setPendingActivate(null)}
        onConfirm={() => {
          if (pendingActivate) performActivate(pendingActivate)
        }}
        title="Activate strategy?"
        message={
          currentlyActive &&
          pendingActivate &&
          currentlyActive.id !== pendingActivate.id
            ? `This will deactivate "${currentlyActive.name}" and start scanning with "${pendingActivate.name}" on the next tick.`
            : pendingActivate
              ? `Start scanning with "${pendingActivate.name}" on the next tick.`
              : ''
        }
        confirmLabel="Activate"
        busy={isPending}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) performDelete(pendingDelete)
        }}
        title="Delete strategy?"
        message={
          pendingDelete
            ? `"${pendingDelete.name}" will be removed permanently. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        busy={isPending}
      />

      <ConfirmDialog
        open={pendingBulkDelete}
        onClose={() => setPendingBulkDelete(false)}
        onConfirm={performBulkDelete}
        title={`Delete ${selectedComposable.length} ${selectedComposable.length === 1 ? 'strategy' : 'strategies'}?`}
        message={
          selectedLegacy.length > 0
            ? `${selectedComposable.length} composable strategies will be removed permanently. ${selectedLegacy.length} framework strategies in the selection will be left alone (use the legacy editor in Settings to delete those). This cannot be undone.`
            : 'These strategies will be removed permanently. This cannot be undone.'
        }
        confirmLabel={`Delete ${selectedComposable.length}`}
        destructive
        busy={isPending}
      />

      <ConfirmDialog
        open={pendingBulkArchive}
        onClose={() => setPendingBulkArchive(false)}
        onConfirm={performBulkArchive}
        title={`Archive ${selectedComposable.length} ${selectedComposable.length === 1 ? 'strategy' : 'strategies'}?`}
        message={
          selectedLegacy.length > 0
            ? `${selectedComposable.length} composable strategies will be archived. ${selectedLegacy.length} framework strategies in the selection will be left alone.`
            : 'These strategies will be archived. You can restore them from the Archived filter.'
        }
        confirmLabel={`Archive ${selectedComposable.length}`}
        busy={isPending}
      />
    </>
  )
}
