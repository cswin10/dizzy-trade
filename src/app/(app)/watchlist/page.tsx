import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getWatchlistView } from '@/app/actions/watchlist'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { WatchlistCandleCountdown } from '@/components/shared/WatchlistCandleCountdown'
import { WatchlistEditButton } from '@/components/shared/WatchlistEditButton'
import { WatchlistFilters } from '@/components/shared/WatchlistFilters'
import { WatchlistPairCard } from '@/components/shared/WatchlistPairCard'
import { WatchlistPriceTicker } from '@/components/shared/WatchlistPriceTicker'
import { Panel } from '@/components/ui/Panel'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  parseFilter,
  parseSort,
  type FilterOption,
  type SortOption,
} from '@/lib/validations/watchlist'

import type { WatchlistPairView } from '@/app/actions/watchlist'

export const metadata = {
  title: 'Watchlist · Dizzy Trade',
}

// Always render fresh: the page mixes live Hyperliquid data with
// database state, so caching would defeat the live readout.
export const dynamic = 'force-dynamic'
export const revalidate = 0

function applyFilter(
  pairs: WatchlistPairView[],
  filter: FilterOption,
): WatchlistPairView[] {
  if (filter === 'all') return pairs
  if (filter === 'majors') return pairs.filter((p) => p.is_major)
  return pairs.filter((p) => !p.is_major)
}

function applySort(
  pairs: WatchlistPairView[],
  sort: SortOption,
): WatchlistPairView[] {
  const out = [...pairs]
  if (sort === 'readiness') {
    out.sort((a, b) => {
      if (a.any_firing !== b.any_firing) return a.any_firing ? -1 : 1
      return b.overall_readiness - a.overall_readiness
    })
  } else if (sort === '24h') {
    out.sort(
      (a, b) =>
        (b.change_24h_pct ?? -Infinity) - (a.change_24h_pct ?? -Infinity),
    )
  } else if (sort === 'volume') {
    out.sort(
      (a, b) =>
        (b.context.volume_24h ?? -Infinity) -
        (a.context.volume_24h ?? -Infinity),
    )
  } else {
    out.sort((a, b) => a.symbol.localeCompare(b.symbol))
  }
  return out
}

export default async function WatchlistPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const sort = parseSort(searchParams.sort)
  const filter = parseFilter(searchParams.filter)

  // Pull the active universe in parallel with the heavy view fetch so
  // the edit modal opens with the full pair list.
  const service = createServiceClient()
  const [view, universeRes] = await Promise.all([
    getWatchlistView(),
    service
      .from('universe')
      .select('symbol')
      .eq('is_active', true)
      .order('symbol', { ascending: true }),
  ])
  const universeSymbols = (universeRes.data ?? []).map((r) => String(r.symbol))
  const initialSelected = view.pairs.map((p) => p.symbol)

  const visiblePairs = applySort(applyFilter(view.pairs, filter), sort)
  const watchlistEmpty = view.pairs.length === 0
  const noActiveStrategy = !view.active_strategy_id

  return (
    <WatchlistPriceTicker>
      <PageContainer>
        <PageHeader
          title="Watchlist"
          subtitle="Your active pairs and their setup status"
          rightSlot={
            <>
              <MonitoringReadout count={view.pairs.length} />
              <WatchlistCandleCountdown />
              <WatchlistEditButton
                universeSymbols={universeSymbols}
                initialSelected={initialSelected}
              />
            </>
          }
        />

        {noActiveStrategy ? (
          <div className="mb-4 rounded-md border border-warning/30 bg-warning/[0.06] px-3 py-2.5 text-xs text-warning">
            No active strategy. Set one in{' '}
            <Link
              href="/settings"
              className="underline transition-colors duration-150 hover:text-white"
            >
              Settings → Strategies
            </Link>{' '}
            to highlight which framework counts as the live setup.
          </div>
        ) : null}

        {watchlistEmpty ? (
          <Panel>
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="font-mono text-[11px] uppercase tracking-widest text-white/40">
                Empty watchlist
              </p>
              <p className="max-w-md text-sm text-white/65">
                Your watchlist is empty. Click{' '}
                <span className="font-mono text-white/80">EDIT WATCHLIST</span>{' '}
                to add pairs to monitor.
              </p>
              <WatchlistEditButton
                universeSymbols={universeSymbols}
                initialSelected={initialSelected}
              />
            </div>
          </Panel>
        ) : (
          <div className="flex flex-col gap-4">
            <WatchlistFilters />
            <div className="flex flex-col gap-3">
              {visiblePairs.length === 0 ? (
                <Panel>
                  <p className="py-8 text-center text-sm text-white/45">
                    No pairs match this filter.
                  </p>
                </Panel>
              ) : (
                visiblePairs.map((pair) => (
                  <WatchlistPairCard
                    key={pair.symbol}
                    pair={pair}
                    activeFrameworkId={view.active_framework_id}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </PageContainer>
    </WatchlistPriceTicker>
  )
}

function MonitoringReadout({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-white/[0.06] bg-surface px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-white/55">
      <span
        aria-hidden
        className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
        style={{ filter: 'drop-shadow(0 0 4px rgba(59,130,255,0.7))' }}
      />
      Monitoring · {count} {count === 1 ? 'pair' : 'pairs'}
    </span>
  )
}
