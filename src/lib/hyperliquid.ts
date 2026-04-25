// Node runtime mirror of the Deno Hyperliquid client used by the scanner
// Edge Function. Same shapes and semantics so app-side code (future
// dashboard widgets, in-process scanner runs in dev) can share logic.

const INFO_URL = 'https://api.hyperliquid.xyz/info'
const DEFAULT_TIMEOUT_MS = 10_000

export type MarketData = {
  symbol: string
  markPrice: number
  funding: number
  openInterest: number
  dayNotionalVolume: number
}

export type Candle = {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

type AssetCtx = {
  funding: string
  openInterest: string
  prevDayPx: string
  dayNtlVlm: string
  markPx: string
  midPx?: string
  oraclePx?: string
}

type MetaAndAssetCtxsResponse = [
  { universe: Array<{ name: string; szDecimals: number }> },
  AssetCtx[],
]

type RawCandle = {
  t: number
  o: string | number
  h: string | number
  l: string | number
  c: string | number
  v: string | number
  s?: string
  i?: string
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
    console.warn(`[hyperliquid] first attempt failed: ${message} (retrying)`)
    return await once()
  }
}

function toNumber(value: string | number | undefined): number {
  if (value === undefined || value === null) return 0
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

export async function getAllMarketData(): Promise<Map<string, MarketData>> {
  const response = await postInfo<MetaAndAssetCtxsResponse>({
    type: 'metaAndAssetCtxs',
  })
  const [meta, ctxs] = response
  const out = new Map<string, MarketData>()
  for (let i = 0; i < meta.universe.length; i++) {
    const entry = meta.universe[i]
    const ctx = ctxs[i]
    if (!entry || !ctx) continue
    out.set(entry.name, {
      symbol: entry.name,
      markPrice: toNumber(ctx.markPx),
      funding: toNumber(ctx.funding),
      openInterest: toNumber(ctx.openInterest),
      dayNotionalVolume: toNumber(ctx.dayNtlVlm),
    })
  }
  return out
}

export async function getCandles(
  symbol: string,
  interval: '1h' | '4h',
  lookback = 100,
): Promise<Candle[]> {
  const now = Date.now()
  const intervalMs = interval === '1h' ? 60 * 60 * 1000 : 4 * 60 * 60 * 1000
  const startTime = now - intervalMs * lookback
  const response = await postInfo<RawCandle[]>({
    type: 'candleSnapshot',
    req: {
      coin: symbol,
      interval,
      startTime,
      endTime: now,
    },
  })
  return response.map((c) => ({
    t: c.t,
    o: toNumber(c.o),
    h: toNumber(c.h),
    l: toNumber(c.l),
    c: toNumber(c.c),
    v: toNumber(c.v),
  }))
}

export type BtcTrendContext = 'up' | 'down' | 'ranging'

const BTC_CONTEXT_LOOKBACK = 50
const BTC_CONTEXT_SMA_WINDOW = 20
const BTC_CONTEXT_BAND_PCT = 0.003 // 0.3% drift band around the SMA
const BTC_CONTEXT_TIMEOUT_MS = 3_000

/**
 * Classifies BTC's recent price action into 'up', 'down', or 'ranging'
 * by comparing the latest 1h close to the SMA of the last 20 closes.
 * Returns null when the network call times out, errors, or the data
 * is too sparse. Designed to be called from `logTradeAction`; the
 * trade insert must always succeed even if this fails.
 */
export async function getBtcContextAtNow(): Promise<BtcTrendContext | null> {
  const fetchPromise = (async () => {
    const candles = await getCandles('BTC', '1h', BTC_CONTEXT_LOOKBACK)
    if (candles.length < BTC_CONTEXT_SMA_WINDOW + 1) return null
    const recent = candles.slice(-BTC_CONTEXT_SMA_WINDOW)
    const sma =
      recent.reduce((acc, candle) => acc + candle.c, 0) / recent.length
    if (!Number.isFinite(sma) || sma <= 0) return null
    const latest = candles[candles.length - 1]!.c
    if (latest > sma * (1 + BTC_CONTEXT_BAND_PCT)) return 'up'
    if (latest < sma * (1 - BTC_CONTEXT_BAND_PCT)) return 'down'
    return 'ranging'
  })()
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), BTC_CONTEXT_TIMEOUT_MS)
  })
  try {
    return await Promise.race([fetchPromise, timeoutPromise])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[btc context] failed: ${message}`)
    return null
  }
}
