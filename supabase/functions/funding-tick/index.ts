// Funding-rate live ingestion.
//
// Runs once an hour via pg_cron. Pulls the most recent funding
// entries for every coin in the live universe and upserts them into
// public.funding_rates. Idempotent via the (coin, ts, interval_hours)
// unique constraint, so a missed tick or a brief overlap is harmless.
//
// Kept separate from the main scanner edge function because the
// scanner is rate-budget-constrained on a one-minute cadence and
// funding rates only update hourly: there is no point hammering the
// fundingHistory endpoint every minute for the same value.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1'

import { fetchRecentFunding } from '../_shared/hyperliquid_funding.ts'

const DEFAULT_COINS = ['BTC', 'ETH', 'SOL']
const LOOKBACK_HOURS = 4
const HARD_BUDGET_MS = 50_000

type TickResult = {
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
  if (error) throw new Error(`universe load failed: ${error.message}`)
  return (data ?? []).map((row) => String(row.symbol))
}

async function tickCoin(coin: string): Promise<TickResult> {
  const result: TickResult = { coin, fetched: 0, inserted: 0 }
  try {
    const entries = await fetchRecentFunding(coin, LOOKBACK_HOURS)
    result.fetched = entries.length
    if (entries.length === 0) return result
    const rows = entries.map((e) => ({
      coin: e.coin,
      ts: new Date(e.time).toISOString(),
      rate: e.rate,
      premium: e.premium,
      interval_hours: 1,
    }))
    const seen = new Set<string>()
    const deduped = rows.filter((row) => {
      const key = `${row.ts}|${row.interval_hours}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const client = supabase()
    const { error, count } = await client
      .from('funding_rates')
      .upsert(deduped, {
        onConflict: 'coin,ts,interval_hours',
        ignoreDuplicates: true,
        count: 'exact',
      })
    if (error) throw new Error(error.message)
    result.inserted = count ?? 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[funding-tick] ${coin} failed: ${message}`)
    result.error = message
  }
  return result
}

Deno.serve(async () => {
  const started = Date.now()
  try {
    let coins: string[] = []
    try {
      coins = await loadUniverseCoins()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[funding-tick] universe load failed, falling back to defaults: ${message}`,
      )
    }
    if (coins.length === 0) coins = DEFAULT_COINS

    const results: TickResult[] = []
    for (const coin of coins) {
      if (Date.now() - started > HARD_BUDGET_MS) {
        console.warn(
          `[funding-tick] hard budget hit at ${Date.now() - started}ms, truncating`,
        )
        break
      }
      results.push(await tickCoin(coin))
    }

    const totalFetched = results.reduce((acc, r) => acc + r.fetched, 0)
    const totalInserted = results.reduce((acc, r) => acc + r.inserted, 0)
    console.log(
      `[funding-tick] coins=${results.length}/${coins.length} fetched=${totalFetched} inserted=${totalInserted} durationMs=${Date.now() - started}`,
    )

    return new Response(
      JSON.stringify({
        ok: true,
        coins: results.length,
        total_fetched: totalFetched,
        total_inserted: totalInserted,
        results,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[funding-tick] fatal: ${message}`)
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
