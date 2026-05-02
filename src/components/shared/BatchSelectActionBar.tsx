'use client'

import Link from 'next/link'

export type BatchSelectActionBarProps = {
  selectedComposable: string[]
  selectedLegacy: string[]
  onClear: () => void
}

// Sticky bottom bar that surfaces while the operator is picking
// strategies on the library page in compare mode. Vanishes when
// fewer than two are selected; the New batch button hands the
// selection off via query params so the new-batch form arrives
// with the picks pre-populated.
export function BatchSelectActionBar({
  selectedComposable,
  selectedLegacy,
  onClear,
}: BatchSelectActionBarProps) {
  const total = selectedComposable.length + selectedLegacy.length
  if (total < 2) return null
  const params = new URLSearchParams()
  if (selectedComposable.length > 0)
    params.set('strategy_definition_ids', selectedComposable.join(','))
  if (selectedLegacy.length > 0)
    params.set('legacy_strategy_ids', selectedLegacy.join(','))

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-base/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <span className="text-sm text-white/85">
          {total} {total === 1 ? 'strategy' : 'strategies'} selected
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white/65 transition-colors hover:border-white/25 hover:text-white"
          >
            Clear
          </button>
          <Link
            href={`/backtest/batch/new?${params.toString()}`}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90"
          >
            Run batch backtest
          </Link>
        </div>
      </div>
    </div>
  )
}
