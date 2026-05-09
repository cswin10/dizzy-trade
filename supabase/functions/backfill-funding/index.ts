// Funding-rate backfill edge function.
//
// Pulls historical funding rates for a list of coins from the
// Hyperliquid `fundingHistory` info endpoint and inserts them into
// the public.funding_rates table. Idempotent via the
// (coin, ts, interval_hours) unique constraint.
//
// Designed to be triggered manually:
//
//   POST /functions/v1/backfill-funding
//   { "coins": ["BTC", "ETH", "SOL"], "lookback_days": 365 }
//
// Both fields are optional. If `coins` is omitted, the function
// pulls every coin marked live in the universe table. If
// `lookback_days` is omitted, the function defaults to 365.
//
// Returns a per-coin summary:
//   { ok: true, results: [{ coin, fetched, inserted, skipped, error? }] }
//
// Self-contained: the Hyperliquid funding client is inlined below
// rather than imported from _shared/ because the Supabase dashboard
// deploy flow only ships this file. The Node mirror lives at
// src/lib/hyperliquid_funding.ts and stays the source of truth for
// shape parity.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1'

// --- Hyperliquid funding-rate client (inlined) ---------------------

const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'
const HL_DEFAULT_TIMEOUT_MS = 10_000
const HL_PAGE_LIMIT = 500
const HL_INTER_PAGE_DELAY_MS = 80

type FundingRateEntry = {
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

function hlToNumber(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function hlToNullableNumber(
  value: string | number | undefined | null,
): number | null {
  if (value === undefined || value === null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function hlSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function hlPostInfo<T>(
  body: Record<string, unknown>,
  timeoutMs = HL_DEFAULT_TIMEOUT_MS,
): Promise<T> {
  async function once(): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(HL_INFO_URL, {
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

function hlNormalise(entries: RawFundingEntry[]): FundingRateEntry[] {
  return entries.map((e) => ({
    coin: e.coin,
    rate: hlToNumber(e.fundingRate),
    premium: hlToNullableNumber(e.premium ?? null),
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
  console.log(
    `[diag] POST ${HL_INFO_URL} body=${JSON.stringify(body)} ` +
      `(startTime=${new Date(startTimeMs).toISOString()}` +
      (endTimeMs !== undefined
        ? ` endTime=${new Date(endTimeMs).toISOString()}`
        : '') +
      `)`,
  )
  const raw = await hlPostInfo<RawFundingEntry[]>(body)
  console.log(
    `[diag] response coin=${coin} rawLength=${Array.isArray(raw) ? raw.length : 'NOT_ARRAY'} ` +
      `firstEntry=${raw && raw[0] ? JSON.stringify(raw[0]) : 'none'} ` +
      `lastEntry=${raw && raw.length > 0 ? JSON.stringify(raw[raw.length - 1]) : 'none'}`,
  )
  return hlNormalise(raw)
}

async function fetchFundingHistory(
  coin: string,
  startTimeMs: number,
  endTimeMs: number = Date.now(),
): Promise<FundingRateEntry[]> {
  console.log(
    `[diag] fetchFundingHistory coin=${coin} ` +
      `startTime=${new Date(startTimeMs).toISOString()} ` +
      `endTime=${new Date(endTimeMs).toISOString()} ` +
      `windowDays=${((endTimeMs - startTimeMs) / 86_400_000).toFixed(2)}`,
  )
  const collected: FundingRateEntry[] = []
  const seen = new Set<number>()
  let cursor = startTimeMs
  for (let iter = 0; iter < 200; iter++) {
    console.log(
      `[diag] loop iter=${iter} coin=${coin} ` +
        `cursor=${new Date(cursor).toISOString()} collectedSoFar=${collected.length}`,
    )
    const page = await fetchFundingHistoryPage(coin, cursor, endTimeMs)
    console.log(
      `[diag] page iter=${iter} coin=${coin} pageLength=${page.length} ` +
        `firstTime=${page[0] ? new Date(page[0].time).toISOString() : 'none'} ` +
        `lastTime=${page.length > 0 ? new Date(page[page.length - 1]!.time).toISOString() : 'none'}`,
    )
    if (page.length === 0) {
      console.log(`[diag] exit reason=empty_page iter=${iter} coin=${coin}`)
      break
    }
    let advanced = false
    let dupesInPage = 0
    for (const entry of page) {
      if (seen.has(entry.time)) {
        dupesInPage++
        continue
      }
      seen.add(entry.time)
      collected.push(entry)
      if (entry.time + 1 > cursor) {
        cursor = entry.time + 1
        advanced = true
      }
    }
    console.log(
      `[diag] post-merge iter=${iter} coin=${coin} ` +
        `dupesInPage=${dupesInPage} advanced=${advanced} ` +
        `newCursor=${new Date(cursor).toISOString()} ` +
        `collectedTotal=${collected.length} pageLength=${page.length} pageLimit=${HL_PAGE_LIMIT}`,
    )
    if (page.length < HL_PAGE_LIMIT) {
      console.log(
        `[diag] exit reason=page_under_limit iter=${iter} coin=${coin} ` +
          `pageLength=${page.length} < pageLimit=${HL_PAGE_LIMIT}`,
      )
      break
    }
    if (!advanced) {
      console.log(`[diag] exit reason=no_advance iter=${iter} coin=${coin}`)
      break
    }
    if (cursor >= endTimeMs) {
      console.log(
        `[diag] exit reason=cursor_past_end iter=${iter} coin=${coin}`,
      )
      break
    }
    await hlSleep(HL_INTER_PAGE_DELAY_MS)
  }
  console.log(
    `[diag] fetchFundingHistory done coin=${coin} totalCollected=${collected.length}`,
  )
  collected.sort((a, b) => a.time - b.time)
  return collected
}

// --- Backfill handler ---------------------------------------------

const DEFAULT_COINS = ['BTC', 'ETH', 'SOL']
const DEFAULT_LOOKBACK_DAYS = 365
const INSERT_CHUNK_SIZE = 1000

type BackfillRequest = {
  coins?: string[]
  lookback_days?: number
  // Optional explicit start time in ms; overrides lookback_days when set.
  start_time_ms?: number
}

type CoinResult = {
  coin: string
  fetched: number
  inserted: number
  error?: string
}

function supabase() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function loadUniverseCoins(): Promise<string[]> {
  const client = supabase()
  const { data, error } = await client
    .from('universe')
    .select('symbol')
    .eq('deployment_status', 'live')
  if (error) {
    throw new Error(`universe load failed: ${error.message}`)
  }
  return (data ?? []).map((row) => String(row.symbol))
}

async function insertFundingRows(
  coin: string,
  rows: Array<{
    coin: string
    ts: string
    rate: number
    premium: number | null
    interval_hours: number
  }>,
): Promise<number> {
  if (rows.length === 0) return 0
  const client = supabase()
  let inserted = 0
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE)
    // Hyperliquid sometimes returns multiple records for the same
    // (coin, ts) tuple in a single page boundary. Dedupe within the
    // chunk so we don't upsert the same row twice and waste a slot.
    const seen = new Set<string>()
    const deduped = chunk.filter((row) => {
      const key = `${row.ts}|${row.interval_hours}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const { error, count } = await client
      .from('funding_rates')
      .upsert(deduped, {
        onConflict: 'coin,ts,interval_hours',
        ignoreDuplicates: true,
        count: 'exact',
      })
    if (error) {
      throw new Error(`funding insert failed for ${coin}: ${error.message}`)
    }
    inserted += count ?? 0
  }
  return inserted
}

async function probeRawFundingHistory(
  coin: string,
  startTimeMs: number,
): Promise<void> {
  // Independent raw probe per the user's suggestion: posts the
  // simplest possible payload (startTime only, no endTime) and logs
  // shape so we can compare what Hyperliquid actually returns
  // against what the helper's pagination loop sees.
  try {
    const body = { type: 'fundingHistory', coin, startTime: startTimeMs }
    console.log(`[probe] POST ${HL_INFO_URL} body=${JSON.stringify(body)}`)
    const res = await fetch(HL_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn(`[probe] ${coin} HTTP ${res.status} ${res.statusText}`)
      return
    }
    const json = (await res.json()) as RawFundingEntry[]
    console.log(
      `[probe] ${coin} rawLength=${Array.isArray(json) ? json.length : 'NOT_ARRAY'}`,
    )
    if (Array.isArray(json) && json.length > 0) {
      console.log(`[probe] ${coin} first=${JSON.stringify(json[0])}`)
      console.log(
        `[probe] ${coin} last=${JSON.stringify(json[json.length - 1])}`,
      )
      // Sample a few middle entries so we can see the cadence.
      const midIdx = Math.floor(json.length / 2)
      console.log(
        `[probe] ${coin} mid[${midIdx}]=${JSON.stringify(json[midIdx])}`,
      )
      // Compute time deltas between consecutive entries to verify
      // the hourly cadence (or detect that we are receiving e.g. a
      // sparse / aggregated subset).
      const deltas: number[] = []
      for (let i = 1; i < Math.min(json.length, 10); i++) {
        deltas.push(json[i]!.time - json[i - 1]!.time)
      }
      console.log(`[probe] ${coin} firstDeltasMs=${JSON.stringify(deltas)}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[probe] ${coin} threw: ${message}`)
  }
}

async function backfillCoin(
  coin: string,
  startTimeMs: number,
): Promise<CoinResult> {
  const result: CoinResult = { coin, fetched: 0, inserted: 0 }
  try {
    await probeRawFundingHistory(coin, startTimeMs)
    const entries = await fetchFundingHistory(coin, startTimeMs)
    result.fetched = entries.length
    if (entries.length === 0) {
      console.log(`[backfill-funding] ${coin}: no entries returned`)
      return result
    }
    const rows = entries.map((e) => ({
      coin: e.coin,
      ts: new Date(e.time).toISOString(),
      rate: e.rate,
      premium: e.premium,
      // Hyperliquid funding settles every hour on perps. The column
      // exists so future contracts with a different cadence can
      // coexist in the same table without conflict.
      interval_hours: 1,
    }))
    result.inserted = await insertFundingRows(coin, rows)
    console.log(
      `[backfill-funding] ${coin}: fetched=${result.fetched} inserted=${result.inserted}`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[backfill-funding] ${coin} failed: ${message}`)
    result.error = message
  }
  return result
}

Deno.serve(async (req) => {
  try {
    let request: BackfillRequest = {}
    if (req.method === 'POST') {
      try {
        const body = await req.text()
        if (body.trim().length > 0) {
          request = JSON.parse(body) as BackfillRequest
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return new Response(
          JSON.stringify({ ok: false, error: `invalid json: ${message}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }
    }

    let coins = request.coins
    if (!coins || coins.length === 0) {
      try {
        coins = await loadUniverseCoins()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(
          `[backfill-funding] universe load failed, falling back to defaults: ${message}`,
        )
        coins = DEFAULT_COINS
      }
      if (coins.length === 0) coins = DEFAULT_COINS
    }

    const startTimeMs =
      request.start_time_ms ??
      Date.now() -
        (request.lookback_days ?? DEFAULT_LOOKBACK_DAYS) * 24 * 60 * 60 * 1000

    console.log(
      `[backfill-funding] starting coins=${coins.length} startTime=${new Date(startTimeMs).toISOString()}`,
    )

    const results: CoinResult[] = []
    let totalFetched = 0
    let totalInserted = 0
    for (const coin of coins) {
      const r = await backfillCoin(coin, startTimeMs)
      results.push(r)
      totalFetched += r.fetched
      totalInserted += r.inserted
    }

    console.log(
      `[backfill-funding] done coins=${coins.length} fetched=${totalFetched} inserted=${totalInserted}`,
    )

    return new Response(
      JSON.stringify({
        ok: true,
        coins: coins.length,
        total_fetched: totalFetched,
        total_inserted: totalInserted,
        results,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[backfill-funding] fatal: ${message}`)
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
