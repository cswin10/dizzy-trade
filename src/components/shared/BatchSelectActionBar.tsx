'use client'

import Link from 'next/link'

export type BatchSelectActionBarProps = {
  selectedComposable: string[]
  selectedLegacy: string[]
  onClear: () => void
  // Optional bulk-mutation handlers. When provided, the bar renders
  // matching buttons that operate over the composable selection only
  // (the per-row Delete / Archive controls already restrict to
  // composable rows, and legacy rows are managed via the legacy
  // editor). Callers gate visibility / busy state themselves.
  onBulkArchive?: () => void
  onBulkDelete?: () => void
  busy?: boolean
}

// Sticky bottom bar shown while the operator is picking strategies
// on the library page. Surfaces with a single selection so bulk
// archive / delete can act on one row, while the batch-backtest
// link only lights up at two or more (the engine needs at least two
// strategies for a meaningful comparison).
export function BatchSelectActionBar({
  selectedComposable,
  selectedLegacy,
  onClear,
  onBulkArchive,
  onBulkDelete,
  busy = false,
}: BatchSelectActionBarProps) {
  const total = selectedComposable.length + selectedLegacy.length
  if (total === 0) return null
  const params = new URLSearchParams()
  if (selectedComposable.length > 0)
    params.set('strategy_definition_ids', selectedComposable.join(','))
  if (selectedLegacy.length > 0)
    params.set('legacy_strategy_ids', selectedLegacy.join(','))

  const composableOnlyCount = selectedComposable.length
  const canBulkActOnComposable = composableOnlyCount > 0 && !busy
  const canRunBatch = total >= 2

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-base/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <span className="text-sm text-white/85">
          {total} {total === 1 ? 'strategy' : 'strategies'} selected
          {selectedLegacy.length > 0 && composableOnlyCount > 0 ? (
            <span className="ml-2 text-xs text-white/45">
              ({composableOnlyCount} composable, {selectedLegacy.length} framework)
            </span>
          ) : null}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white/65 transition-colors hover:border-white/25 hover:text-white"
          >
            Clear
          </button>
          {onBulkArchive ? (
            <button
              type="button"
              onClick={onBulkArchive}
              disabled={!canBulkActOnComposable}
              title={
                composableOnlyCount === 0
                  ? 'Archive applies to composable strategies only'
                  : undefined
              }
              className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white/65 transition-colors hover:border-white/25 hover:text-white disabled:opacity-40"
            >
              Archive ({composableOnlyCount})
            </button>
          ) : null}
          {onBulkDelete ? (
            <button
              type="button"
              onClick={onBulkDelete}
              disabled={!canBulkActOnComposable}
              title={
                composableOnlyCount === 0
                  ? 'Delete applies to composable strategies only'
                  : undefined
              }
              className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white/65 transition-colors hover:border-red-500/40 hover:text-red-300 disabled:opacity-40"
            >
              Delete ({composableOnlyCount})
            </button>
          ) : null}
          {canRunBatch ? (
            <Link
              href={`/backtest/batch/new?${params.toString()}`}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90"
            >
              Run batch backtest
            </Link>
          ) : (
            <span
              className="rounded-md bg-accent/40 px-3 py-1.5 text-xs font-medium text-white/60"
              title="Select at least two strategies to run a batch backtest"
            >
              Run batch backtest
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
