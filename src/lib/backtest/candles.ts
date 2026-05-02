// Historical candle fetcher with a Postgres-backed cache. The
// backtest engine asks for a date range; this module reads what is
// already in `backtest_candles`, fills any missing chunks from
// Hyperliquid's candleSnapshot endpoint, and writes the new candles
// back to the cache so future runs do not pay the network cost again.
//
// Hyperliquid returns at most ~5000 candles per call, so for short
// timeframes over long ranges we issue several batched requests. A
// small inter-batch delay keeps us comfortably under their rate limit.

import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'

import {
  TIMEFRAME_MS,
  type BacktestCandle,
  type BacktestTimeframe,
} from './types'

const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info'
const MAX_CANDLES_PER_REQUEST = 5000
const INTER_BATCH_DELAY_MS = 80
const MAX_RETRIES = 5
const REQUEST_TIMEOUT_MS = 15_000

type RawCandle = {
  t: number
  o: string | number
  h: string | number
  l: string | number
  c: string | number
  v: string | number
}

function toNumber(value: string | number | undefined): number {
  if (value === undefined || value === null) return 0
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Retries with exponential backoff on 429 responses, up to MAX_RETRIES
// attempts. A small random jitter (0-200ms) is added to each backoff
// so that parallel sweep batches that all trip the rate limit at the
// same time do not retry in lockstep and re-trip it.
async function postCandleSnapshot(
  pair: string,
  timeframe: BacktestTimeframe,
  startMs: number,
  endMs: number,
): Promise<RawCandle[]> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const baseDelayMs = 1000 * Math.pow(2, attempt - 1)
      const jitterMs = Math.floor(Math.random() * 200)
      await sleep(baseDelayMs + jitterMs)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(HYPERLIQUID_INFO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'candleSnapshot',
          req: {
            coin: pair,
            interval: timeframe,
            startTime: startMs,
            endTime: endMs,
          },
        }),
        signal: controller.signal,
      })
      if (res.status === 429) {
        lastError = new Error('Hyperliquid 429 rate limit')
        continue
      }
      if (!res.ok) {
        throw new Error(
          `Hyperliquid candleSnapshot ${res.status} ${res.statusText}`,
        )
      }
      return (await res.json()) as RawCandle[]
    } catch (error) {
      lastError = error
      // Non-429 errors do not retry; fall through to throw.
      if (
        error instanceof Error &&
        !error.message.includes('429') &&
        error.name !== 'AbortError'
      ) {
        throw error
      }
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Hyperliquid request failed after retries')
}

async function fetchCandlesFromHyperliquid(
  pair: string,
  timeframe: BacktestTimeframe,
  startMs: number,
  endMs: number,
): Promise<BacktestCandle[]> {
  const raw = await postCandleSnapshot(pair, timeframe, startMs, endMs)
  return raw.map((c) => ({
    pair,
    timeframe,
    candle_open_at: new Date(c.t),
    open: toNumber(c.o),
    high: toNumber(c.h),
    low: toNumber(c.l),
    close: toNumber(c.c),
    volume: toNumber(c.v),
  }))
}

// Splits the requested range into chunks that fit inside the
// per-request candle cap, then issues them sequentially with a small
// pause between calls. Returns a flat list, deduplicated and sorted.
async function fetchAllChunks(
  pair: string,
  timeframe: BacktestTimeframe,
  startMs: number,
  endMs: number,
): Promise<BacktestCandle[]> {
  const tfMs = TIMEFRAME_MS[timeframe]
  const chunkMs = MAX_CANDLES_PER_REQUEST * tfMs
  const collected: BacktestCandle[] = []

  let cursor = startMs
  while (cursor < endMs) {
    const chunkEnd = Math.min(cursor + chunkMs, endMs)
    const chunk = await fetchCandlesFromHyperliquid(
      pair,
      timeframe,
      cursor,
      chunkEnd,
    )
    collected.push(...chunk)
    cursor = chunkEnd
    if (cursor < endMs) await sleep(INTER_BATCH_DELAY_MS)
  }

  const seen = new Set<number>()
  const deduped: BacktestCandle[] = []
  for (const candle of collected) {
    const key = candle.candle_open_at.getTime()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(candle)
  }
  deduped.sort(
    (a, b) => a.candle_open_at.getTime() - b.candle_open_at.getTime(),
  )
  return deduped
}

// Reads any cached candles that overlap the requested range so the
// caller can skip refetching them.
async function readCachedCandles(
  pair: string,
  timeframe: BacktestTimeframe,
  startAt: Date,
  endAt: Date,
): Promise<BacktestCandle[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('backtest_candles')
    .select('pair, timeframe, candle_open_at, open, high, low, close, volume')
    .eq('pair', pair)
    .eq('timeframe', timeframe)
    .gte('candle_open_at', startAt.toISOString())
    .lte('candle_open_at', endAt.toISOString())
    .order('candle_open_at', { ascending: true })
  if (error) throw new Error(`Cache read failed: ${error.message}`)
  return (data ?? []).map((row) => ({
    pair: row.pair,
    timeframe: row.timeframe,
    candle_open_at: new Date(row.candle_open_at),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  }))
}

// Inserts candles into the cache, ignoring duplicates via the
// (pair, timeframe, candle_open_at) unique constraint. Done in
// chunks so a long-range backfill does not balloon a single insert
// statement.
async function writeCandlesToCache(candles: BacktestCandle[]): Promise<void> {
  if (candles.length === 0) return
  const service = createServiceClient()
  const chunkSize = 1000
  for (let i = 0; i < candles.length; i += chunkSize) {
    const chunk = candles.slice(i, i + chunkSize)
    const rows = chunk.map((c) => ({
      pair: c.pair,
      timeframe: c.timeframe,
      candle_open_at: c.candle_open_at.toISOString(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }))
    const { error } = await service.from('backtest_candles').upsert(rows, {
      onConflict: 'pair,timeframe,candle_open_at',
      ignoreDuplicates: true,
    })
    if (error) throw new Error(`Cache write failed: ${error.message}`)
  }
}

// Returns every candle in the requested range, fetching anything
// missing from Hyperliquid and caching it on the way through. The
// result is sorted ascending by candle_open_at.
//
// The cache-fill heuristic is intentionally simple: if the cache has
// fewer candles than we expect for the range (allowing for missed
// candles around exchange downtime), refetch the entire window. This
// avoids the complexity of stitching exact gap ranges and is fast
// enough in practice given Hyperliquid's per-call cap.
// In-flight dedupe map. When several runBacktest invocations execute
// in parallel inside the same Node process (e.g. a sweep batch fan-
// out via Promise.all), they all call ensureCandles for the same
// (pair, timeframe, range) tuple. Without this map each one would
// independently miss the cache, fire its own Hyperliquid request,
// and trip the rate limit. With it, the first caller fires the
// request and the others await its promise and share the result.
//
// The map is keyed by the exact arguments, scoped to the lifetime
// of one process. It is intentionally not persistent: a fresh
// Vercel function invocation starts with an empty map, which is
// fine because the on-disk Postgres cache already covers the
// cross-process case.
const inFlight = new Map<string, Promise<BacktestCandle[]>>()

function inFlightKey(
  pair: string,
  timeframe: BacktestTimeframe,
  startAt: Date,
  endAt: Date,
): string {
  return `${pair}|${timeframe}|${startAt.getTime()}|${endAt.getTime()}`
}

export async function ensureCandles(
  pair: string,
  timeframe: BacktestTimeframe,
  startAt: Date,
  endAt: Date,
): Promise<BacktestCandle[]> {
  const tfMs = TIMEFRAME_MS[timeframe]
  if (!tfMs) throw new Error(`Unsupported timeframe: ${timeframe}`)

  const key = inFlightKey(pair, timeframe, startAt, endAt)
  const existing = inFlight.get(key)
  if (existing) return existing

  const promise = (async () => {
    const cached = await readCachedCandles(pair, timeframe, startAt, endAt)
    const expected = Math.floor((endAt.getTime() - startAt.getTime()) / tfMs)
    // 90% threshold absorbs the occasional gap (exchange downtime,
    // newly listed pair) without forcing a refetch every time.
    if (cached.length >= expected * 0.9 && cached.length > 0) {
      return cached
    }

    const fetched = await fetchAllChunks(
      pair,
      timeframe,
      startAt.getTime(),
      endAt.getTime(),
    )
    if (fetched.length === 0) return cached

    await writeCandlesToCache(fetched)

    const cachedKeys = new Set(cached.map((c) => c.candle_open_at.getTime()))
    const merged = [...cached]
    for (const candle of fetched) {
      if (!cachedKeys.has(candle.candle_open_at.getTime())) {
        merged.push(candle)
      }
    }
    merged.sort(
      (a, b) => a.candle_open_at.getTime() - b.candle_open_at.getTime(),
    )
    return merged
  })()

  inFlight.set(key, promise)
  try {
    return await promise
  } finally {
    inFlight.delete(key)
  }
}
