// GBP/USD rate fetcher with a 1-hour in-memory cache.
//
// Uses Frankfurter (https://api.frankfurter.app), which is free, has
// no auth, and serves ECB reference rates. The Edge Function instance
// is reused across cron ticks so the module-level cache survives long
// enough to keep API hits trivial.
//
// If the API fails, we fall back to a hardcoded 1.27 (close enough
// for v1 sizing) and log a warning so the operator can see something
// went wrong without breaking the scan.

const FALLBACK_RATE = 1.27
const CACHE_TTL_MS = 60 * 60 * 1000

type CacheEntry = { rate: number; expiresAt: number }
let cache: CacheEntry | null = null

type FrankfurterResponse = {
  amount?: number
  base?: string
  date?: string
  rates?: Record<string, number>
}

/**
 * Returns the current GBP→USD rate. Cached for one hour per Edge
 * Function instance.
 *
 * @example
 *   const rate = await getGbpUsdRate() // 1.27
 *   const usd = pounds * rate
 */
export async function getGbpUsdRate(): Promise<number> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) return cache.rate

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    let response: Response
    try {
      response = await fetch(
        'https://api.frankfurter.app/latest?from=GBP&to=USD',
        { signal: controller.signal },
      )
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      throw new Error(`frankfurter ${response.status}`)
    }
    const body = (await response.json()) as FrankfurterResponse
    const rate = body.rates?.USD
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new Error('frankfurter response missing USD rate')
    }
    cache = { rate, expiresAt: now + CACHE_TTL_MS }
    return rate
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      `[fx] GBP/USD fetch failed (${message}), using fallback ${FALLBACK_RATE}`,
    )
    return FALLBACK_RATE
  }
}
