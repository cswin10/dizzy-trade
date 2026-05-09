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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1'

import { fetchFundingHistory } from '../_shared/hyperliquid_funding.ts'

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

async function backfillCoin(
  coin: string,
  startTimeMs: number,
): Promise<CoinResult> {
  const result: CoinResult = { coin, fetched: 0, inserted: 0 }
  try {
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
