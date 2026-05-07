'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState, useTransition } from 'react'

import { twMerge } from 'tailwind-merge'

import {
  activateStrategyDefinitionAction,
  archiveStrategyDefinitionAction,
  deactivateStrategyDefinitionAction,
  deleteStrategyDefinitionAction,
  type StrategyLibraryRow,
} from '@/app/actions/strategy-definitions'
import { toggleStrategyActiveAction } from '@/app/actions/strategies'
import {
  STRATEGY_CATEGORIES,
  type StrategyCategory,
} from '@/lib/strategies/categories'

import { ConfirmDialog } from './ConfirmDialog'

export type StrategyLibraryListProps = {
  rows: StrategyLibraryRow[]
}

type CategoryFilter = 'all' | StrategyCategory
type StatusFilter = 'all' | 'live' | 'paused' | 'draft' | 'archived'
type SortKey = 'newest' | 'oldest' | 'name_asc' | 'name_desc'

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'live', label: 'Live' },
  { value: 'paused', label: 'Paused' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
]

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name_asc', label: 'Name A-Z' },
  { value: 'name_desc', label: 'Name Z-A' },
]

const CATEGORY_SET = new Set<string>(STRATEGY_CATEGORIES)
const STATUS_SET = new Set<StatusFilter>([
  'all',
  'live',
  'paused',
  'draft',
  'archived',
])
const SORT_SET = new Set<SortKey>([
  'newest',
  'oldest',
  'name_asc',
  'name_desc',
])

function formatDate(iso: string | null): string {
  if (!iso) return '-'
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
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [pendingActivate, setPendingActivate] =
    useState<StrategyLibraryRow | null>(null)
  const [pendingDelete, setPendingDelete] = useState<StrategyLibraryRow | null>(
    null,
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pendingBulkArchive, setPendingBulkArchive] = useState(false)

  // Filter state lives in the URL so a hunting session is bookmarkable
  // and survives a full page refresh. We read once per render rather
  // than holding parallel useState — the URL is the source of truth.
  const search = (searchParams.get('q') ?? '').trim()
  const categoryParam = searchParams.get('category')
  const category: CategoryFilter =
    categoryParam && CATEGORY_SET.has(categoryParam)
      ? (categoryParam as StrategyCategory)
      : 'all'
  const statusParam = (searchParams.get('status') ?? 'all') as StatusFilter
  const status: StatusFilter = STATUS_SET.has(statusParam)
    ? statusParam
    : 'all'
  const sortParam = (searchParams.get('sort') ?? 'newest') as SortKey
  const sort: SortKey = SORT_SET.has(sortParam) ? sortParam : 'newest'
  const hasActiveFilters =
    search.length > 0 ||
    category !== 'all' ||
    status !== 'all' ||
    sort !== 'newest'

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams.toString())
      if (value === null || value === '') {
        next.delete(key)
      } else {
        next.set(key, value)
      }
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  function clearFilters() {
    router.replace(pathname, { scroll: false })
  }

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
    const q = search.toLowerCase()
    const out = rows.filter((row) => {
      // Search across name + description (description is composable
      // only; framework rows just match on name).
      if (q.length > 0) {
        const hay =
          `${row.name} ${row.description ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      // Category filter only applies to composable rows since
      // framework rows are forced to 'Other'. When the operator
      // picks a non-Other category we hide framework rows
      // entirely; for 'Other' or 'all' both sources show through.
      if (category !== 'all') {
        if (row.category !== category) return false
      }
      // Status mirrors deployment_status; 'archived' is a special
      // case that also catches composable is_archived rows.
      if (status === 'live' && !row.is_active) return false
      if (status === 'paused' && row.deployment_status !== 'paused')
        return false
      if (status === 'draft' && row.deployment_status !== 'draft')
        return false
      if (status === 'archived') {
        const archived =
          row.is_archived || row.deployment_status === 'archived'
        if (!archived) return false
      } else {
        // For non-archived filters, hide composable rows that have
        // been soft-archived so the default view stays uncluttered.
        if (row.source === 'composable' && row.is_archived) return false
      }
      return true
    })
    out.sort((a, b) => {
      if (sort === 'name_asc') {
        return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
      }
      if (sort === 'name_desc') {
        return b.name.localeCompare(a.name, 'en', { sensitivity: 'base' })
      }
      const at = a.updated_at
        ? Date.parse(a.updated_at)
        : a.created_at
          ? Date.parse(a.created_at)
          : 0
      const bt = b.updated_at
        ? Date.parse(b.updated_at)
        : b.created_at
          ? Date.parse(b.created_at)
          : 0
      return sort === 'oldest' ? at - bt : bt - at
    })
    return out
  }, [rows, search, category, status, sort])

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

  const archivableSelectedCount = selectedComposable.length

  return (
    <>
      {/* Filters: search box + three dropdowns + clear. The grid
          collapses to two columns on mobile so the row stays
          legible without horizontal scroll. */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_repeat(3,180px)_auto]">
        <input
          type="search"
          value={search}
          onChange={(e) => updateParam('q', e.target.value || null)}
          placeholder="Search name or description"
          className="col-span-2 h-9 w-full rounded-md border border-white/10 bg-transparent px-3 text-sm text-white outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent sm:col-span-1"
        />
        <select
          value={category}
          onChange={(e) =>
            updateParam(
              'category',
              e.target.value === 'all' ? null : e.target.value,
            )
          }
          className="h-9 rounded-md border border-white/10 bg-transparent px-2 text-sm text-white outline-none focus:border-accent"
        >
          <option value="all">All categories</option>
          {STRATEGY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) =>
            updateParam(
              'status',
              e.target.value === 'all' ? null : e.target.value,
            )
          }
          className="h-9 rounded-md border border-white/10 bg-transparent px-2 text-sm text-white outline-none focus:border-accent"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) =>
            updateParam(
              'sort',
              e.target.value === 'newest' ? null : e.target.value,
            )
          }
          className="h-9 rounded-md border border-white/10 bg-transparent px-2 text-sm text-white outline-none focus:border-accent"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={clearFilters}
          disabled={!hasActiveFilters}
          className="col-span-2 h-9 rounded-md border border-white/10 px-3 text-xs text-white/65 transition-colors hover:border-white/25 hover:text-white disabled:cursor-default disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:text-white/65 sm:col-span-1"
        >
          Clear filters
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-white/45">
        <span>
          {filtered.length} of {rows.length}
        </span>
        {selected.size > 0 ? (
          <>
            <span className="text-white/65">·</span>
            <span className="text-white/65">{selected.size} selected</span>
            <button
              type="button"
              onClick={() => setPendingBulkArchive(true)}
              disabled={isPending || archivableSelectedCount === 0}
              className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs text-amber-200 transition-colors hover:bg-amber-400/20 disabled:opacity-40"
            >
              Archive selected
              {archivableSelectedCount !== selected.size
                ? ` (${archivableSelectedCount})`
                : ''}
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-xs text-white/45 hover:text-white"
            >
              Clear
            </button>
          </>
        ) : null}
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {filtered.map((row) => {
          const key = `${row.source}:${row.id}`
          const isComposable = row.source === 'composable'
          const checkboxDisabled = !isComposable || row.is_archived
          return (
            <li
              key={key}
              className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-surface px-4 py-3 transition-colors hover:border-white/10 hover:bg-surface-2"
            >
              <input
                type="checkbox"
                aria-label={`Select ${row.name}`}
                checked={selected.has(key)}
                onChange={() => toggleRowSelected(row)}
                disabled={checkboxDisabled}
                title={
                  !isComposable
                    ? 'Bulk archive is composable-only'
                    : row.is_archived
                      ? 'Already archived'
                      : undefined
                }
              />
              <Link
                href={
                  isComposable
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
                      isComposable
                        ? 'bg-accent/15 text-accent'
                        : 'bg-white/10 text-white/55',
                    )}
                  >
                    {isComposable ? 'composable' : 'framework'}
                  </span>
                  {isComposable ? (
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/65">
                      {row.category}
                    </span>
                  ) : null}
                  {row.is_active ? (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                      live
                    </span>
                  ) : null}
                  {row.deployment_status === 'paused' ? (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                      paused
                    </span>
                  ) : null}
                  {row.deployment_status === 'draft' && !row.is_active ? (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/55">
                      draft
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
                {isComposable ? (
                  <Link
                    href={`/settings/strategies/${row.id}/edit`}
                    className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/65 hover:border-white/25 hover:text-white"
                  >
                    Edit
                  </Link>
                ) : null}
                {isComposable && !row.is_archived ? (
                  <button
                    type="button"
                    onClick={() => performArchive(row)}
                    disabled={isPending}
                    className="rounded-md border border-white/10 px-2 py-1 text-xs text-white/55 transition-colors hover:border-white/25 hover:text-white disabled:opacity-40"
                  >
                    Archive
                  </button>
                ) : null}
                {isComposable ? (
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
          )
        })}
      </ul>

      {filtered.length === 0 ? (
        <p className="mt-3 text-xs text-white/45">
          No strategies match the current filters.
        </p>
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
        open={pendingBulkArchive}
        onClose={() => setPendingBulkArchive(false)}
        onConfirm={performBulkArchive}
        title={`Archive ${archivableSelectedCount} ${
          archivableSelectedCount === 1 ? 'strategy' : 'strategies'
        }?`}
        message={
          selectedLegacy.length > 0
            ? `${archivableSelectedCount} composable strategies will be archived. ${selectedLegacy.length} framework strategies in the selection will be left alone (use the legacy editor in Settings to archive those).`
            : 'These strategies will be archived. You can restore them from the Archived filter.'
        }
        confirmLabel={`Archive ${archivableSelectedCount}`}
        busy={isPending}
      />
    </>
  )
}
