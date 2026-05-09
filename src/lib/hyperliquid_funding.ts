// Hyperliquid funding-rate client. Mirrors the shape of the
// candle/market-data fetchers in `hyperliquid.ts` but targets the
// `fundingHistory` info endpoint.
//
// The endpoint returns up to 500 entries per call newest-last. For
// long backfill ranges we page forward by `startTime` until the
// response is empty or short of the page cap. A small inter-page
// delay keeps us comfortably under the public rate limit.

import 'server-only'

const INFO_URL = 'https://api.hyperliquid.xyz/info'
const DEFAULT_TIMEOUT_MS = 10_000
const PAGE_LIMIT = 500
const INTER_PAGE_DELAY_MS = 80

export type FundingRateEntry = {
  coin: string
  rate: number
  premium: number | null
  time: number
}

type RawFundingEntry = {
  coin: string
  fundingRate: string | number
  premium?: string | number | null
  time: number
}

function toNumber(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function toNullableNumber(
  value: string | number | undefined | null,
): number | null {
  if (value === undefined || value === null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postInfo<T>(
  body: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  async function once(): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(INFO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`Hyperliquid ${res.status} ${res.statusText}`)
      }
      return (await res.json()) as T
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    return await once()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      `[hyperliquid_funding] first attempt failed: ${message} (retrying)`,
    )
    return await once()
  }
}

function normalise(entries: RawFundingEntry[]): FundingRateEntry[] {
  return entries.map((e) => ({
    coin: e.coin,
    rate: toNumber(e.fundingRate),
    premium: toNullableNumber(e.premium ?? null),
    time: e.time,
  }))
}

// Single-page fetch for `fundingHistory`. Returns at most ~500
// entries newest-last in the (startTime, endTime] window.
async function fetchFundingHistoryPage(
  coin: string,
  startTimeMs: number,
  endTimeMs?: number,
): Promise<FundingRateEntry[]> {
  const body: Record<string, unknown> = {
    type: 'fundingHistory',
    coin,
    startTime: startTimeMs,
  }
  if (endTimeMs !== undefined) body.endTime = endTimeMs
  const raw = await postInfo<RawFundingEntry[]>(body)
  return normalise(raw)
}

// Pages forward through `fundingHistory` until the API returns an
// empty page or one shorter than the per-page cap. Pages are
// deduplicated by `time` so any overlap on the boundary is dropped.
// Returns chronologically ascending entries.
export async function fetchFundingHistory(
  coin: string,
  startTimeMs: number,
  endTimeMs: number = Date.now(),
): Promise<FundingRateEntry[]> {
  const collected: FundingRateEntry[] = []
  const seen = new Set<number>()
  let cursor = startTimeMs
  // Hard ceiling on iterations to protect against an upstream change
  // that breaks the "fewer than PAGE_LIMIT means done" exit.
  for (let iter = 0; iter < 200; iter++) {
    const page = await fetchFundingHistoryPage(coin, cursor, endTimeMs)
    if (page.length === 0) break
    let advanced = false
    for (const entry of page) {
      if (seen.has(entry.time)) continue
      seen.add(entry.time)
      collected.push(entry)
      if (entry.time + 1 > cursor) {
        cursor = entry.time + 1
        advanced = true
      }
    }
    if (page.length < PAGE_LIMIT) break
    if (!advanced) break
    if (cursor >= endTimeMs) break
    await sleep(INTER_PAGE_DELAY_MS)
  }
  collected.sort((a, b) => a.time - b.time)
  return collected
}

// Convenience wrapper for live ingestion: pulls roughly the last
// `lookbackHours` of funding rates for a single coin.
export async function fetchRecentFunding(
  coin: string,
  lookbackHours = 4,
): Promise<FundingRateEntry[]> {
  const now = Date.now()
  const startTimeMs = now - lookbackHours * 60 * 60 * 1000
  return fetchFundingHistory(coin, startTimeMs, now)
}
