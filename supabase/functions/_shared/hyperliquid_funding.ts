// Deno-runtime mirror of `src/lib/hyperliquid_funding.ts`. Used by
// the backfill-funding edge function and the scanner's funding-tick
// extension to fetch historical and current funding rates from the
// Hyperliquid `fundingHistory` info endpoint.

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

export async function fetchFundingHistory(
  coin: string,
  startTimeMs: number,
  endTimeMs: number = Date.now(),
): Promise<FundingRateEntry[]> {
  const collected: FundingRateEntry[] = []
  const seen = new Set<number>()
  let cursor = startTimeMs
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

export async function fetchRecentFunding(
  coin: string,
  lookbackHours = 4,
): Promise<FundingRateEntry[]> {
  const now = Date.now()
  const startTimeMs = now - lookbackHours * 60 * 60 * 1000
  return fetchFundingHistory(coin, startTimeMs, now)
}
