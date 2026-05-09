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
// the nearest funding event before we treat the data as missing.
// One hour matches Hyperliquid's hourly funding cadence: every
// candle should land within an hour of a published rate. Backtests
// that run on coins with 8h-cadence funding need to widen this.
export const FUNDING_LOOKUP_WINDOW_MS = 60 * 60 * 1000

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
  console.log(
    `[funding-diag] loadFundingRates query coin=${JSON.stringify(coin)} ` +
      `coinLen=${coin.length} ` +
      `from=${startAt.toISOString()} to=${endAt.toISOString()}`,
  )
  const { data, error } = await service
    .from('funding_rates')
    .select('ts, rate, premium, interval_hours')
    .eq('coin', coin)
    .gte('ts', startAt.toISOString())
    .lte('ts', endAt.toISOString())
    .order('ts', { ascending: true })
  if (error) {
    console.error(
      `[funding-diag] loadFundingRates ERROR coin=${coin} message=${error.message}`,
    )
    throw new Error(`funding rate load failed: ${error.message}`)
  }
  const rows = data ?? []
  console.log(
    `[funding-diag] loadFundingRates result coin=${coin} rowCount=${rows.length} ` +
      `firstRowTs=${rows[0]?.ts ?? 'none'} ` +
      `lastRowTs=${rows[rows.length - 1]?.ts ?? 'none'}`,
  )
  // Probe: if the filtered query returned zero, try an unfiltered
  // count for the same coin so we can see whether the issue is the
  // coin name (zero rows for any window) or the time window.
  if (rows.length === 0) {
    const probe = await service
      .from('funding_rates')
      .select('ts, coin', { count: 'exact', head: false })
      .eq('coin', coin)
      .order('ts', { ascending: false })
      .limit(1)
    console.log(
      `[funding-diag] loadFundingRates probe coin=${coin} ` +
        `unfilteredCount=${probe.count ?? 'null'} ` +
        `latestRow=${JSON.stringify(probe.data?.[0] ?? null)} ` +
        `probeError=${probe.error?.message ?? 'none'}`,
    )
    // Second probe: distinct coin names actually in the table.
    const distinctProbe = await service
      .from('funding_rates')
      .select('coin')
      .order('coin', { ascending: true })
      .limit(50)
    const distinctCoins = Array.from(
      new Set((distinctProbe.data ?? []).map((r) => r.coin as string)),
    )
    console.log(
      `[funding-diag] loadFundingRates distinct-coins-sample=${JSON.stringify(distinctCoins)} ` +
        `distinctProbeError=${distinctProbe.error?.message ?? 'none'}`,
    )
  }
  return rows.map((row) => ({
    ts: new Date(row.ts as string).getTime(),
    rate: Number(row.rate),
    premium: row.premium === null ? null : Number(row.premium),
    interval_hours: Number(row.interval_hours),
  }))
}

// Binary-searches for the funding rate whose timestamp is closest
// to `candleMs` and within ±FUNDING_LOOKUP_WINDOW_MS of it. Returns
// null if nothing within that window exists. Caller treats null as
// "missing data" rather than "rate is zero".
//
// `points` MUST be sorted ascending by ts (loadFundingRates guarantees
// this); we don't re-sort here so per-candle lookups stay O(log n).
export function fundingRateAt(
  points: FundingRatePoint[],
  candleMs: number,
  windowMs = FUNDING_LOOKUP_WINDOW_MS,
): FundingRatePoint | null {
  if (points.length === 0) return null
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (points[mid]!.ts < candleMs) lo = mid + 1
    else hi = mid
  }
  // `lo` now points at the first entry with ts >= candleMs (or the
  // last entry if all are < candleMs). Pick whichever of (lo, lo-1)
  // is closer.
  let best: FundingRatePoint | null = null
  let bestDist = Infinity
  for (const idx of [lo - 1, lo]) {
    if (idx < 0 || idx >= points.length) continue
    const candidate = points[idx]!
    const dist = Math.abs(candidate.ts - candleMs)
    if (dist < bestDist) {
      best = candidate
      bestDist = dist
    }
  }
  if (!best || bestDist > windowMs) return null
  return best
}
