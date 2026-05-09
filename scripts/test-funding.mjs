#!/usr/bin/env node
// Smoke tests for the funding-rate ingestion wiring.
//
// 1. Hits the Hyperliquid /info fundingHistory endpoint live and
//    confirms it returns sensible rows for BTC.
// 2. Exercises the same fundingRateAt binary search the engine uses
//    against a synthetic point set, covering exact / near / out-of-
//    window / empty cases.
// 3. Drives the funding_threshold condition logic through both the
//    "rate present" and "rate missing" paths, matching what the
//    backtest engine will see when it walks each candle.
//
// Run with: node scripts/test-funding.mjs
//
// No DB access required; everything is in-process or live HTTP.

function ok(label) {
  console.log(`PASS  ${label}`)
}
function fail(label, detail) {
  console.error(`FAIL  ${label}: ${detail}`)
  process.exitCode = 1
}

async function testHyperliquidLive() {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
  let res
  try {
    res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'fundingHistory',
        coin: 'BTC',
        startTime: oneDayAgo,
      }),
    })
  } catch (error) {
    console.warn(`SKIP  hyperliquid live: ${error.message}`)
    return
  }
  if (!res.ok) {
    console.warn(`SKIP  hyperliquid live: ${res.status} ${res.statusText} (sandbox?)`)
    return
  }
  const data = await res.json()
  if (!Array.isArray(data) || data.length === 0) {
    fail('hyperliquid live', 'empty array')
    return
  }
  const sample = data[0]
  if (
    typeof sample.coin !== 'string' ||
    sample.fundingRate === undefined ||
    typeof sample.time !== 'number'
  ) {
    fail('hyperliquid live', `bad shape: ${JSON.stringify(sample)}`)
    return
  }
  ok(`hyperliquid live (BTC last 24h: ${data.length} rows, sample rate=${sample.fundingRate})`)
}

// Inlined copy of fundingRateAt from src/lib/backtest/funding.ts.
// Backward-only lookup with a 2h window; the test mirrors that
// shape. Real implementation stays the source of truth, this is
// a self-contained sanity check.
function fundingRateAt(points, candleMs, windowMs = 2 * 60 * 60 * 1000) {
  if (points.length === 0) return null
  let lo = 0
  let hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (points[mid].ts <= candleMs) lo = mid + 1
    else hi = mid
  }
  const idx = lo - 1
  if (idx < 0) return null
  const candidate = points[idx]
  if (candleMs - candidate.ts > windowMs) return null
  return candidate
}

function testFundingLookup() {
  const base = 1_000_000_000_000
  const points = []
  for (let i = 0; i < 10; i++) {
    points.push({ ts: base + i * 3_600_000, rate: 0.0001 * i })
  }

  // Exact hit at a funding ts: returns that funding row.
  const a = fundingRateAt(points, base + 3 * 3_600_000)
  if (!a || Math.abs(a.rate - 0.0003) > 1e-9) {
    fail('lookup exact', JSON.stringify(a))
    return
  }
  ok('lookup exact hit')

  // 30 min after a funding ts: returns the prior row (still
  // within 2h backward).
  const b = fundingRateAt(points, base + 3 * 3_600_000 + 30 * 60_000)
  if (!b || Math.abs(b.rate - 0.0003) > 1e-9) {
    fail('lookup +30min', JSON.stringify(b))
    return
  }
  ok('lookup +30min returns prior funding row')

  // 1h30m past the last funding ts: still within 2h, picks last
  // (no future row exists, so backward lookup must succeed).
  const b2 = fundingRateAt(
    points,
    base + 9 * 3_600_000 + 90 * 60_000,
  )
  if (!b2 || Math.abs(b2.rate - 0.0009) > 1e-9) {
    fail('lookup +1h30m past last', JSON.stringify(b2))
    return
  }
  ok('lookup +1h30m past last point returns last funding (within 2h)')

  // 2h01m past the last point: outside the window, null.
  const c = fundingRateAt(
    points,
    base + 9 * 3_600_000 + (2 * 60 + 1) * 60_000,
  )
  if (c !== null) {
    fail('lookup past window', `expected null, got ${JSON.stringify(c)}`)
    return
  }
  ok('lookup +2h01m past last point returns null')

  // Before the first point: backward lookup has nothing, null.
  const cBefore = fundingRateAt(points, base - 1)
  if (cBefore !== null) {
    fail('lookup before first', `expected null, got ${JSON.stringify(cBefore)}`)
    return
  }
  ok('lookup before first point returns null (no lookahead)')

  // Empty array.
  const d = fundingRateAt([], base)
  if (d !== null) {
    fail('lookup empty', 'expected null')
    return
  }
  ok('lookup empty returns null')
}

function testCondition() {
  function compareAll(value, comparator, threshold) {
    if (comparator === 'lt') return value < threshold
    if (comparator === 'lte') return value <= threshold
    if (comparator === 'gt') return value > threshold
    if (comparator === 'gte') return value >= threshold
    return false
  }
  function evalCondition(funding, comparator, value) {
    if (funding === undefined || funding === null) {
      return {
        passed: false,
        values: { value: null, missing_data: true, reason: 'no funding data' },
      }
    }
    return { passed: compareAll(funding, comparator, value), values: { funding } }
  }

  const a = evalCondition(0.001, 'gt', 0.0005)
  if (!a.passed) {
    fail('condition gt over', JSON.stringify(a))
    return
  }
  ok('condition gt over-threshold passes')

  const b = evalCondition(0.0001, 'gt', 0.0005)
  if (b.passed || b.values.missing_data) {
    fail('condition gt under', JSON.stringify(b))
    return
  }
  ok('condition gt under-threshold fails (real signal, not missing_data)')

  const c = evalCondition(undefined, 'gt', 0.0005)
  if (c.passed || !c.values.missing_data || c.values.reason !== 'no funding data') {
    fail('condition missing', JSON.stringify(c))
    return
  }
  ok('condition with missing funding -> missing_data + reason')
}

async function main() {
  await testHyperliquidLive()
  testFundingLookup()
  testCondition()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
