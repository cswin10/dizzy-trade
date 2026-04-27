import { z } from 'zod'

export const WATCHLIST_MIN = 3
export const WATCHLIST_MAX = 12

export const updateWatchlistSchema = z.object({
  symbols: z
    .array(z.string().min(1).max(32))
    .min(WATCHLIST_MIN, `Watchlist needs at least ${WATCHLIST_MIN} pairs`)
    .max(WATCHLIST_MAX, `Watchlist allows at most ${WATCHLIST_MAX} pairs`),
})

export type UpdateWatchlistInput = z.infer<typeof updateWatchlistSchema>

export const SORT_OPTIONS = ['readiness', '24h', 'volume', 'alpha'] as const
export type SortOption = (typeof SORT_OPTIONS)[number]

export const FILTER_OPTIONS = ['all', 'narrative_leaders', 'majors'] as const
export type FilterOption = (typeof FILTER_OPTIONS)[number]

export const SORT_LABELS: Record<SortOption, string> = {
  readiness: 'Setup readiness',
  '24h': '24H change',
  volume: 'Volume',
  alpha: 'Alphabetical',
}

export const FILTER_LABELS: Record<FilterOption, string> = {
  all: 'All',
  narrative_leaders: 'Narrative leaders',
  majors: 'Majors',
}

export const MAJOR_SYMBOLS = ['BTC', 'ETH', 'SOL'] as const

export function parseSort(raw: string | string[] | undefined): SortOption {
  const v = Array.isArray(raw) ? raw[0] : raw
  return SORT_OPTIONS.find((s) => s === v) ?? 'readiness'
}

export function parseFilter(raw: string | string[] | undefined): FilterOption {
  const v = Array.isArray(raw) ? raw[0] : raw
  return FILTER_OPTIONS.find((f) => f === v) ?? 'all'
}
