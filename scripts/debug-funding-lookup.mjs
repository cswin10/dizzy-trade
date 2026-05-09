#!/usr/bin/env node
// Ground-truth probe for the backtest funding lookup.
//
// Connects to the same database the engine reads from, pulls a real
// slice of funding_rates and backtest_candles for BTC, and runs the
// exact fundingRateAt logic the engine uses against them. Prints
// raw bytes / numbers / parsed Dates side by side so any timestamp
// drift or encoding mismatch is visible without guessing.
//
// Usage:
//
//   cd dizzy-trade
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/debug-funding-lookup.mjs
//
// Optional env vars:
//   COIN=BTC                         coin to probe (default BTC)
//   TIMEFRAME=1h                     candle timeframe (default 1h)
//   START_AT=2025-05-09T00:00:00Z    backtest window start
//   END_AT=2026-05-09T00:00:00Z      backtest window end
//   SAMPLE_CANDLES=10                how many candles to test

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.',
  )
  process.exit(1)
}

const COIN = process.env.COIN ?? 'BTC'
const TIMEFRAME = process.env.TIMEFRAME ?? '1h'
const START_AT = process.env.START_AT ?? '2025-05-09T00:00:00Z'
const END_AT = process.env.END_AT ?? '2026-05-09T00:00:00Z'
const SAMPLE_CANDLES = Number(process.env.SAMPLE_CANDLES ?? '10')
const WINDOW_MS = 2 * 60 * 60 * 1000

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Verbatim copy of fundingRateAt from src/lib/backtest/funding.ts
// (current production version). Backward-only, 2h window.
function fundingRateAt(points, candleMs, windowMs = WINDOW_MS) {
  if (points.length === 0) return { result: null, reason: 'no_points' }
  let lo = 0
  let hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (points[mid].ts <= candleMs) lo = mid + 1
    else hi = mid
  }
  const idx = lo - 1
  if (idx < 0) {
    return {
      result: null,
      reason: 'no_point_at_or_before_candle',
      firstPointTs: points[0].ts,
    }
  }
  const candidate = points[idx]
  const distMs = candleMs - candidate.ts
  if (distMs > windowMs) {
    return {
      result: null,
      reason: 'window_exceeded',
      candidateTs: candidate.ts,
      distMs,
      windowMs,
    }
  }
  return { result: candidate, distMs }
}

function fmt(ms) {
  return `${ms} (${new Date(ms).toISOString()})`
}

async function main() {
  console.log(`probe: coin=${COIN} timeframe=${TIMEFRAME}`)
  console.log(`window: ${START_AT} -> ${END_AT}`)
  console.log(`lookup window: ${WINDOW_MS}ms (${WINDOW_MS / 3600000}h)`)
  console.log('')

  // 1) funding_rates for the coin in the window.
  const fr = await supabase
    .from('funding_rates')
    .select('ts, rate, premium, interval_hours')
    .eq('coin', COIN)
    .gte('ts', START_AT)
    .lte('ts', END_AT)
    .order('ts', { ascending: true })
  if (fr.error) {
    console.error('funding_rates query error:', fr.error)
    process.exit(2)
  }
  const fundingRows = fr.data ?? []
  console.log(`funding_rates: ${fundingRows.length} rows for coin="${COIN}"`)
  if (fundingRows.length > 0) {
    const first = fundingRows[0]
    const last = fundingRows[fundingRows.length - 1]
    console.log(
      `  first row: raw_ts=${JSON.stringify(first.ts)} -> parsed=${fmt(new Date(first.ts).getTime())}`,
    )
    console.log(`              rate=${first.rate} (typeof ${typeof first.rate})`)
    console.log(
      `  last  row: raw_ts=${JSON.stringify(last.ts)} -> parsed=${fmt(new Date(last.ts).getTime())}`,
    )
    // Inter-row delta sanity
    if (fundingRows.length > 1) {
      const d = new Date(fundingRows[1].ts).getTime() - new Date(fundingRows[0].ts).getTime()
      console.log(`  delta(row[1]-row[0]) = ${d}ms (${d / 60000}min)`)
    }
  } else {
    // No rows for this coin in window. Two probes: any rows for
    // this coin at all, and what coins are actually present.
    const anyForCoin = await supabase
      .from('funding_rates')
      .select('ts', { count: 'exact', head: false })
      .eq('coin', COIN)
      .order('ts', { ascending: false })
      .limit(1)
    console.log(
      `  probe: total rows for coin="${COIN}" (any window) = ${anyForCoin.count ?? 'null'}`,
    )
    if (anyForCoin.data?.[0]) {
      console.log(`         latest ts = ${JSON.stringify(anyForCoin.data[0].ts)}`)
    }
    const distinct = await supabase
      .from('funding_rates')
      .select('coin')
      .limit(200)
    const coins = Array.from(new Set((distinct.data ?? []).map((r) => r.coin)))
    console.log(`  probe: distinct coins in funding_rates = ${JSON.stringify(coins)}`)
  }
  console.log('')

  // 2) backtest_candles for the coin/timeframe.
  const bc = await supabase
    .from('backtest_candles')
    .select('candle_open_at, open, close, pair, timeframe')
    .eq('pair', COIN)
    .eq('timeframe', TIMEFRAME)
    .gte('candle_open_at', START_AT)
    .lte('candle_open_at', END_AT)
    .order('candle_open_at', { ascending: true })
    .limit(SAMPLE_CANDLES)
  if (bc.error) {
    console.error('backtest_candles query error:', bc.error)
    process.exit(3)
  }
  const candleRows = bc.data ?? []
  console.log(
    `backtest_candles: ${candleRows.length} rows sampled for pair="${COIN}" timeframe="${TIMEFRAME}"`,
  )
  if (candleRows.length === 0) {
    console.log(
      `  probe: trying without timeframe filter and without window ...`,
    )
    const anyForPair = await supabase
      .from('backtest_candles')
      .select('pair, timeframe', { count: 'exact', head: false })
      .eq('pair', COIN)
      .limit(1)
    console.log(
      `         total rows for pair="${COIN}" = ${anyForPair.count ?? 'null'}`,
    )
    const distinctPairs = await supabase
      .from('backtest_candles')
      .select('pair')
      .limit(200)
    const pairs = Array.from(
      new Set((distinctPairs.data ?? []).map((r) => r.pair)),
    )
    console.log(`         distinct pairs in backtest_candles = ${JSON.stringify(pairs)}`)
    process.exit(0)
  }
  const firstCandle = candleRows[0]
  console.log(
    `  first candle raw_open_at=${JSON.stringify(firstCandle.candle_open_at)} ` +
      `-> parsed=${fmt(new Date(firstCandle.candle_open_at).getTime())}`,
  )
  console.log('')

  // 3) Side-by-side: do candle ts and funding ts align at all?
  if (fundingRows.length > 0 && candleRows.length > 0) {
    const c0 = new Date(candleRows[0].candle_open_at).getTime()
    const f0 = new Date(fundingRows[0].ts).getTime()
    console.log(`alignment check (first of each):`)
    console.log(`  first candle ts = ${fmt(c0)}`)
    console.log(`  first funding ts = ${fmt(f0)}`)
    console.log(`  diff (candle - funding) = ${c0 - f0}ms (${(c0 - f0) / 60000}min)`)
    console.log('')
  }

  // 4) Build the points array exactly like loadFundingRates does
  // and run fundingRateAt against the first SAMPLE_CANDLES candles.
  const points = fundingRows.map((row) => ({
    ts: new Date(row.ts).getTime(),
    rate: Number(row.rate),
    premium: row.premium === null ? null : Number(row.premium),
    interval_hours: Number(row.interval_hours),
  }))
  console.log(`points array: length=${points.length}`)
  if (points.length > 0) {
    console.log(`  points[0].ts = ${fmt(points[0].ts)}`)
    console.log(`  points[${points.length - 1}].ts = ${fmt(points[points.length - 1].ts)}`)
  }
  console.log('')

  console.log(`fundingRateAt result for first ${candleRows.length} candles:`)
  let nullCount = 0
  let hitCount = 0
  for (const candle of candleRows) {
    const candleMs = new Date(candle.candle_open_at).getTime()
    const r = fundingRateAt(points, candleMs)
    if (r.result) {
      hitCount++
      console.log(
        `  candle=${fmt(candleMs)} -> HIT ts=${fmt(r.result.ts)} rate=${r.result.rate} dist=${r.distMs}ms`,
      )
    } else {
      nullCount++
      const detail = Object.entries(r)
        .filter(([k]) => k !== 'result')
        .map(([k, v]) => `${k}=${typeof v === 'number' ? fmt(v) : v}`)
        .join(' ')
      console.log(`  candle=${fmt(candleMs)} -> NULL ${detail}`)
    }
  }
  console.log('')
  console.log(`summary: ${hitCount} hits, ${nullCount} nulls (out of ${candleRows.length})`)

  if (nullCount === candleRows.length && points.length > 0) {
    console.log('')
    console.log('DIAGNOSIS: every lookup returned null despite non-empty points array.')
    console.log('Compare the alignment-check diff above and the points[0]/points[last] timestamps')
    console.log('against the first candle timestamp to see the offset.')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
