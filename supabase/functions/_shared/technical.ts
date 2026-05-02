// Shared technical analysis helpers for the Deno scanner runtime.
//
// Kept in lockstep with src/lib/technical.ts: same function names, same
// signatures, same numeric results. If you touch one, touch the other.

import type { Candle } from './hyperliquid.ts'

// Internal fractal window: a swing needs this many confirming candles
// on each side. Small enough to pick up meaningful local extremes on
// 4h candles without being overly restrictive.
const FRACTAL_WINDOW = 2

/**
 * Simple moving average of the last `period` values.
 *
 * @example
 *   sma([1, 2, 3, 4, 5], 3) // 4
 *   sma([1, 2], 5)          // NaN (not enough samples)
 */
export function sma(values: number[], period: number): number {
  if (period <= 0 || values.length < period) return NaN
  let sum = 0
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i]!
  }
  return sum / period
}

/**
 * Wilder's RSI computed over the full closes array. Returns the RSI at
 * the last close. Needs at least `period + 1` samples; returns NaN
 * otherwise.
 *
 * @example
 *   rsi([44, 44.3, 44.1, 43.6, 44.3, 44.8, 45.1, 45.6, 45.3, 45.7,
 *        45.2, 45, 44.7, 44.5, 45], 14) // around 61
 */
export function rsi(closes: number[], period: number): number {
  if (period <= 0 || closes.length <= period) return NaN
  let gains = 0
  let losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/**
 * Swing highs inside the most recent `lookback` candles. A swing high
 * is a candle whose high exceeds the FRACTAL_WINDOW candles either
 * side. Returned in chronological order (oldest first).
 *
 * @example
 *   findSwingHighs(candles, 50) // [{ index: 32, price: 1.82 }, ...]
 */
export function findSwingHighs(
  candles: Candle[],
  lookback: number,
): { index: number; price: number }[] {
  const out: { index: number; price: number }[] = []
  const n = candles.length
  const start = Math.max(FRACTAL_WINDOW, n - lookback)
  for (let i = start; i < n - FRACTAL_WINDOW; i++) {
    const high = candles[i]!.h
    let isSwing = true
    for (let j = i - FRACTAL_WINDOW; j <= i + FRACTAL_WINDOW; j++) {
      if (j === i) continue
      if (candles[j]!.h > high) {
        isSwing = false
        break
      }
    }
    if (isSwing) out.push({ index: i, price: high })
  }
  return out
}

/**
 * Swing lows inside the most recent `lookback` candles, mirror of
 * findSwingHighs.
 *
 * @example
 *   findSwingLows(candles, 50) // [{ index: 18, price: 1.41 }, ...]
 */
export function findSwingLows(
  candles: Candle[],
  lookback: number,
): { index: number; price: number }[] {
  const out: { index: number; price: number }[] = []
  const n = candles.length
  const start = Math.max(FRACTAL_WINDOW, n - lookback)
  for (let i = start; i < n - FRACTAL_WINDOW; i++) {
    const low = candles[i]!.l
    let isSwing = true
    for (let j = i - FRACTAL_WINDOW; j <= i + FRACTAL_WINDOW; j++) {
      if (j === i) continue
      if (candles[j]!.l < low) {
        isSwing = false
        break
      }
    }
    if (isSwing) out.push({ index: i, price: low })
  }
  return out
}

/**
 * Most recent swing high whose age (distance from the last candle) is
 * at least `minAge`. Null when no such swing exists.
 *
 * @example
 *   mostRecentSwingHigh(candles, 50, 10) // { index: 78, price: 2.14 }
 */
export function mostRecentSwingHigh(
  candles: Candle[],
  lookback: number,
  minAge: number,
): { index: number; price: number } | null {
  const swings = findSwingHighs(candles, lookback)
  const lastIdx = candles.length - 1
  for (let i = swings.length - 1; i >= 0; i--) {
    const s = swings[i]!
    if (lastIdx - s.index >= minAge) return s
  }
  return null
}

/**
 * Most recent swing low whose age is at least `minAge`. Null otherwise.
 *
 * @example
 *   mostRecentSwingLow(candles, 50, 10) // { index: 65, price: 1.52 }
 */
export function mostRecentSwingLow(
  candles: Candle[],
  lookback: number,
  minAge: number,
): { index: number; price: number } | null {
  const swings = findSwingLows(candles, lookback)
  const lastIdx = candles.length - 1
  for (let i = swings.length - 1; i >= 0; i--) {
    const s = swings[i]!
    if (lastIdx - s.index >= minAge) return s
  }
  return null
}

/**
 * Nearest round-number level for a price, with step sizes that scale
 * by magnitude.
 *
 *   price < $1          step $0.01
 *   $1 - $10            step $0.25
 *   $10 - $100          step $1
 *   $100 - $1000        step $10
 *   >= $1000            step $100
 *
 * @example
 *   roundNumberProximity(47.30)   // 47
 *   roundNumberProximity(3.12)    // 3
 *   roundNumberProximity(1275)    // 1300
 */
export function roundNumberProximity(price: number): number {
  const abs = Math.abs(price)
  let step: number
  if (abs < 1) step = 0.01
  else if (abs < 10) step = 0.25
  else if (abs < 100) step = 1
  else if (abs < 1000) step = 10
  else step = 100
  return Math.round(price / step) * step
}

/**
 * Absolute body size of a candle.
 *
 * @example
 *   candleBody({ o: 10, c: 12, h: 13, l: 9, t: 0, v: 0 }) // 2
 */
export function candleBody(c: Candle): number {
  return Math.abs(c.c - c.o)
}

/**
 * Upper wick length (high minus the top of the body).
 *
 * @example
 *   candleUpperWick({ o: 10, c: 12, h: 13, l: 9, t: 0, v: 0 }) // 1
 */
export function candleUpperWick(c: Candle): number {
  return c.h - Math.max(c.o, c.c)
}

/**
 * Lower wick length (bottom of the body minus low).
 *
 * @example
 *   candleLowerWick({ o: 10, c: 12, h: 13, l: 9, t: 0, v: 0 }) // 1
 */
export function candleLowerWick(c: Candle): number {
  return Math.min(c.o, c.c) - c.l
}

/**
 * Position of the close within the candle range, 0 at the low and 1
 * at the high. Returns 0.5 for a zero-range candle so callers don't
 * divide by zero.
 *
 * @example
 *   candleClosePosition({ o: 10, c: 12, h: 13, l: 9, t: 0, v: 0 }) // 0.75
 */
export function candleClosePosition(c: Candle): number {
  const range = c.h - c.l
  if (range <= 0) return 0.5
  return (c.c - c.l) / range
}

/**
 * Exponential moving average. Mirrors src/lib/technical.ts.
 */
export function ema(values: number[], period: number): number {
  if (period <= 0 || values.length < period) return NaN
  const k = 2 / (period + 1)
  let avg = 0
  for (let i = 0; i < period; i++) avg += values[i]!
  avg /= period
  for (let i = period; i < values.length; i++) {
    avg = values[i]! * k + avg * (1 - k)
  }
  return avg
}

export function emaSeries(values: number[], period: number): number[] {
  const out: number[] = []
  if (period <= 0 || values.length < period) return out
  const k = 2 / (period + 1)
  let avg = 0
  for (let i = 0; i < period; i++) avg += values[i]!
  avg /= period
  out.push(avg)
  for (let i = period; i < values.length; i++) {
    avg = values[i]! * k + avg * (1 - k)
    out.push(avg)
  }
  return out
}

/**
 * Wilder-smoothed average true range.
 */
export function atr(candles: Candle[], period: number): number {
  if (period <= 0 || candles.length <= period) return NaN
  const trueRanges: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i]!
    const prev = candles[i - 1]!
    const tr = Math.max(
      cur.h - cur.l,
      Math.abs(cur.h - prev.c),
      Math.abs(cur.l - prev.c),
    )
    trueRanges.push(tr)
  }
  let avg = 0
  for (let i = 0; i < period; i++) avg += trueRanges[i]!
  avg /= period
  for (let i = period; i < trueRanges.length; i++) {
    avg = (avg * (period - 1) + trueRanges[i]!) / period
  }
  return avg
}

export function atrSeries(candles: Candle[], period: number): number[] {
  const out: number[] = []
  if (period <= 0 || candles.length <= period) return out
  const trueRanges: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i]!
    const prev = candles[i - 1]!
    trueRanges.push(
      Math.max(
        cur.h - cur.l,
        Math.abs(cur.h - prev.c),
        Math.abs(cur.l - prev.c),
      ),
    )
  }
  let avg = 0
  for (let i = 0; i < period; i++) avg += trueRanges[i]!
  avg /= period
  out.push(avg)
  for (let i = period; i < trueRanges.length; i++) {
    avg = (avg * (period - 1) + trueRanges[i]!) / period
    out.push(avg)
  }
  return out
}

export function bollinger(
  closes: number[],
  period: number,
  stdDevMultiple: number,
): { upper: number; middle: number; lower: number } | null {
  if (period <= 0 || closes.length < period) return null
  const window = closes.slice(closes.length - period)
  const mean = window.reduce((a, b) => a + b, 0) / period
  const variance = window.reduce((sum, x) => sum + (x - mean) ** 2, 0) / period
  const sd = Math.sqrt(variance)
  return {
    upper: mean + sd * stdDevMultiple,
    middle: mean,
    lower: mean - sd * stdDevMultiple,
  }
}

export function stochastic(
  candles: Candle[],
  kPeriod: number,
  dPeriod: number,
  smooth: number,
): { k: number; d: number; kPrev: number; dPrev: number } | null {
  if (kPeriod <= 0 || dPeriod <= 0 || smooth <= 0) return null
  if (candles.length < kPeriod + smooth + dPeriod) return null
  const rawK: number[] = []
  for (let i = kPeriod - 1; i < candles.length; i++) {
    let highest = -Infinity
    let lowest = Infinity
    for (let j = i - kPeriod + 1; j <= i; j++) {
      const c = candles[j]!
      if (c.h > highest) highest = c.h
      if (c.l < lowest) lowest = c.l
    }
    const range = highest - lowest
    const close = candles[i]!.c
    rawK.push(range === 0 ? 50 : ((close - lowest) / range) * 100)
  }
  const smoothedK: number[] = []
  for (let i = smooth - 1; i < rawK.length; i++) {
    let s = 0
    for (let j = i - smooth + 1; j <= i; j++) s += rawK[j]!
    smoothedK.push(s / smooth)
  }
  const dValues: number[] = []
  for (let i = dPeriod - 1; i < smoothedK.length; i++) {
    let s = 0
    for (let j = i - dPeriod + 1; j <= i; j++) s += smoothedK[j]!
    dValues.push(s / dPeriod)
  }
  if (smoothedK.length < 2 || dValues.length < 2) return null
  return {
    k: smoothedK[smoothedK.length - 1]!,
    kPrev: smoothedK[smoothedK.length - 2]!,
    d: dValues[dValues.length - 1]!,
    dPrev: dValues[dValues.length - 2]!,
  }
}

export function williamsR(candles: Candle[], period: number): number {
  if (period <= 0 || candles.length < period) return NaN
  let highest = -Infinity
  let lowest = Infinity
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i]!
    if (c.h > highest) highest = c.h
    if (c.l < lowest) lowest = c.l
  }
  const range = highest - lowest
  if (range === 0) return -50
  const close = candles[candles.length - 1]!.c
  return ((highest - close) / range) * -100
}
