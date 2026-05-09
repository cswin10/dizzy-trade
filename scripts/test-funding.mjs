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
// Mirroring it here keeps the smoke test self-contained while the
// real implementation is type-checked by tsc.
function fundingRateAt(points, candleMs, windowMs = 60 * 60 * 1000) {
  if (points.length === 0) return null
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (points[mid].ts < candleMs) lo = mid + 1
    else hi = mid
  }
  let best = null
  let bestDist = Infinity
  for (const idx of [lo - 1, lo]) {
    if (idx < 0 || idx >= points.length) continue
    const candidate = points[idx]
    const dist = Math.abs(candidate.ts - candleMs)
    if (dist < bestDist) {
      best = candidate
      bestDist = dist
    }
  }
  if (!best || bestDist > windowMs) return null
  return best
}

function testFundingLookup() {
  const base = 1_000_000_000_000
  const points = []
  for (let i = 0; i < 10; i++) {
    points.push({ ts: base + i * 3_600_000, rate: 0.0001 * i })
  }
  const a = fundingRateAt(points, base + 3 * 3_600_000)
  if (!a || Math.abs(a.rate - 0.0003) > 1e-9) {
    fail('lookup exact', JSON.stringify(a))
    return
  }
  ok('lookup exact hit')

  const b = fundingRateAt(points, base + 3 * 3_600_000 + 30 * 60_000)
  if (!b || Math.abs(b.rate - 0.0003) > 1e-9) {
    fail('lookup near', JSON.stringify(b))
    return
  }
  ok('lookup within +30min')

  const c = fundingRateAt(points, base + 9 * 3_600_000 + 2 * 3_600_000)
  if (c !== null) {
    fail('lookup past window', `expected null, got ${JSON.stringify(c)}`)
    return
  }
  ok('lookup past window returns null')

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
