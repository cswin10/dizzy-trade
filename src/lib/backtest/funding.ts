// Funding-rate loader for the backtest engine.
//
// Reads from public.funding_rates rather than re-fetching from
// Hyperliquid: backfill jobs are responsible for populating that
// table, and the backtest engine treats it as authoritative. The
// engine asks for one coin's worth of rates spanning a date range;
// this module returns a sorted list and a small helper to look up
// the prevailing rate at an arbitrary candle timestamp.

import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'

export type FundingRatePoint = {
  ts: number
  rate: number
  premium: number | null
  interval_hours: number
}

// Maximum lookup window: how far the candle timestamp may be from
// the most recent funding event before we treat the data as missing.
// Hyperliquid pays funding once per hour, but the published `time`
// does not always sit exactly on the candle's open timestamp (the
// settlement event lands a few seconds / minutes after the hour
// boundary, and longer-dated coins occasionally drop a tick). Two
// hours absorbs that drift while still flagging real gaps in the
// stored history. Backtests on coins with 8h-cadence funding need
// a wider window.
export const FUNDING_LOOKUP_WINDOW_MS = 2 * 60 * 60 * 1000

// Pulls every funding-rate row for `coin` in [startAt, endAt].
// Sorted ascending by ts. Returned in ms so the engine can compare
// directly against candle timestamps without re-parsing dates on
// every lookup.
export async function loadFundingRates(
  coin: string,
  startAt: Date,
  endAt: Date,
): Promise<FundingRatePoint[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('funding_rates')
    .select('ts, rate, premium, interval_hours')
    .eq('coin', coin)
    .gte('ts', startAt.toISOString())
    .lte('ts', endAt.toISOString())
    .order('ts', { ascending: true })
  if (error) throw new Error(`funding rate load failed: ${error.message}`)
  return (data ?? []).map((row) => ({
    ts: new Date(row.ts as string).getTime(),
    rate: Number(row.rate),
    premium: row.premium === null ? null : Number(row.premium),
    interval_hours: Number(row.interval_hours),
  }))
}

// Binary-searches for the most recent funding rate at or before
// `candleMs`, within `windowMs` of it. Backward-only by design:
// a backtest evaluating candle N must not see funding that was
// published at or after candle N's open, that would be lookahead.
// Returns null when nothing on or before the candle exists, or
// when the latest such rate is older than the window.
//
// `points` MUST be sorted ascending by ts (loadFundingRates
// guarantees this); we don't re-sort here so per-candle lookups
// stay O(log n).
//
// Diagnostics: when `diag` is supplied the function calls it once
// per call with a structured reason so a caller (e.g. the engine)
// can log a small sample of failures without forking the lookup
// logic. The diag callback is intentionally optional to keep the
// hot-path branchless when nothing is observing.
export type FundingLookupDiag =
  | { reason: 'no_points' }
  | { reason: 'no_point_at_or_before'; firstPointTs: number; candleMs: number }
  | {
      reason: 'window_exceeded'
      candidateTs: number
      candleMs: number
      distMs: number
      windowMs: number
    }
  | { reason: 'hit'; candidateTs: number; candleMs: number; distMs: number }

export function fundingRateAt(
  points: FundingRatePoint[],
  candleMs: number,
  windowMs = FUNDING_LOOKUP_WINDOW_MS,
  diag?: (info: FundingLookupDiag) => void,
): FundingRatePoint | null {
  if (points.length === 0) {
    diag?.({ reason: 'no_points' })
    return null
  }
  // Find the largest index whose ts <= candleMs. Standard
  // upper-bound binary search: lo lands one past the last
  // qualifying entry, so the answer is lo - 1.
  let lo = 0
  let hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (points[mid]!.ts <= candleMs) lo = mid + 1
    else hi = mid
  }
  const idx = lo - 1
  if (idx < 0) {
    diag?.({
      reason: 'no_point_at_or_before',
      firstPointTs: points[0]!.ts,
      candleMs,
    })
    return null
  }
  const candidate = points[idx]!
  const distMs = candleMs - candidate.ts
  if (distMs > windowMs) {
    diag?.({
      reason: 'window_exceeded',
      candidateTs: candidate.ts,
      candleMs,
      distMs,
      windowMs,
    })
    return null
  }
  diag?.({
    reason: 'hit',
    candidateTs: candidate.ts,
    candleMs,
    distMs,
  })
  return candidate
}
