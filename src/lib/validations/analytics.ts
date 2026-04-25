import { z } from 'zod'

// Analytics filters live in the URL so views are shareable and
// bookmarkable. The schema parses raw query string values into a
// clean shape the data layer can consume.

// V1 milestone: 50 closed trades. Lives here rather than the server
// action module because 'use server' files only permit async-function
// exports.
export const TRADES_GOAL = 50

export const DATE_RANGE_PRESETS = ['all', '7d', '30d', '90d'] as const
export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number]

export type AnalyticsDateRange = DateRangePreset | { from: Date; to: Date }

export type AnalyticsFilters = {
  date_range: AnalyticsDateRange
  pairs: string[] | null
  direction: 'all' | 'long' | 'short'
  narrative: string | null
  outcome: 'all' | 'win' | 'loss' | 'breakeven'
}

const dateRangeSchema = z.union([
  z.enum(DATE_RANGE_PRESETS),
  z.object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  }),
])

export const analyticsFiltersSchema: z.ZodType<AnalyticsFilters> = z.object({
  date_range: dateRangeSchema,
  pairs: z.array(z.string().trim().min(1).max(32)).nullable(),
  direction: z.enum(['all', 'long', 'short']),
  narrative: z.string().trim().max(64).nullable(),
  outcome: z.enum(['all', 'win', 'loss', 'breakeven']),
})

const RAW_PRESETS = new Set<string>(DATE_RANGE_PRESETS)

/**
 * Reads a Next.js searchParams object into a typed AnalyticsFilters.
 * Unknown values fall back to the most permissive option (`all` for
 * date and outcome, `null` for pairs and narrative).
 *
 * @example
 *   parseFiltersFromSearchParams({ range: '30d', direction: 'long' })
 */
export function parseFiltersFromSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): AnalyticsFilters {
  const range = pickString(searchParams.range)
  let dateRange: AnalyticsDateRange = 'all'
  if (range && RAW_PRESETS.has(range)) {
    dateRange = range as DateRangePreset
  } else {
    const from = pickString(searchParams.from)
    const to = pickString(searchParams.to)
    if (from && to) {
      const fromDate = new Date(from)
      const toDate = new Date(to)
      if (
        !Number.isNaN(fromDate.getTime()) &&
        !Number.isNaN(toDate.getTime())
      ) {
        dateRange = { from: fromDate, to: toDate }
      }
    }
  }

  const pairsRaw = pickString(searchParams.pairs)
  const pairs = pairsRaw
    ? pairsRaw
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : null

  const direction = (() => {
    const raw = pickString(searchParams.direction)
    return raw === 'long' || raw === 'short' ? raw : 'all'
  })()

  const outcome = (() => {
    const raw = pickString(searchParams.outcome)
    return raw === 'win' || raw === 'loss' || raw === 'breakeven' ? raw : 'all'
  })()

  const narrativeRaw = pickString(searchParams.narrative)
  const narrative = narrativeRaw && narrativeRaw !== 'all' ? narrativeRaw : null

  return {
    date_range: dateRange,
    pairs: pairs && pairs.length > 0 ? pairs : null,
    direction,
    narrative,
    outcome,
  }
}

function pickString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
