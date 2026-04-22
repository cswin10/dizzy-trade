import type { Framework, FrameworkResult, MarketSnapshot } from './types.ts'

// Framework 3: Liquidation Hunt
// -----------------------------
// Rationale: When funding is extreme and OI is elevated, crowded trades
// line up on one side. A sharp wick in the opposite direction, rejected
// back inside the previous range, is a common liquidation cascade
// signature: forced liquidations blow through stops, then price snaps
// back as the imbalance clears.
//
// All four conditions must hold for the alert to fire.

const FUNDING_THRESHOLD = 0.0001 // 1 bp per hour (Hyperliquid funding is hourly)
const OI_MULTIPLIER = 1.3 // 30% above 24h rolling average
const WICK_BODY_RATIO = 1.5 // wick must be at least 1.5x the candle body
const STOP_BUFFER = 0.002 // 0.2% buffer beyond the wick extreme
const TARGET_R_MULTIPLE = 2 // target at 2R

export const liquidationHuntFramework: Framework = {
  id: 'liquidation_hunt_v1',
  name: 'Liquidation hunt',
  description:
    'Extreme funding plus elevated open interest plus a rejected wick opposite to the funding bias.',
  dataRequirements: {
    needsCandles1h: true,
    needsFundingHistory: false,
    needsOiHistory: true,
  },
  evaluate(snapshot: MarketSnapshot): FrameworkResult {
    const conditionValues: Record<string, number | string | boolean> = {
      funding: snapshot.funding,
      openInterest: snapshot.openInterest,
    }

    // Condition 1: absolute funding above threshold. Positive funding
    // means longs pay shorts, which usually means price has been pushed
    // up by crowded longs. Negative is the mirror.
    const absFunding = Math.abs(snapshot.funding)
    conditionValues.absFunding = absFunding
    conditionValues.fundingThreshold = FUNDING_THRESHOLD
    if (absFunding <= FUNDING_THRESHOLD) {
      return { triggered: false, conditionValues }
    }

    // Condition 2: OI elevated above the 24h rolling average. Empty
    // history means we haven't captured enough snapshots yet; fail
    // gracefully rather than firing a noisy first-minute alert.
    const oiHistory = snapshot.oiHistory ?? []
    if (oiHistory.length === 0) {
      conditionValues.oiHistoryLength = 0
      return { triggered: false, conditionValues }
    }
    const oiAvg = oiHistory.reduce((acc, x) => acc + x, 0) / oiHistory.length
    const oiRatio = oiAvg > 0 ? snapshot.openInterest / oiAvg : 0
    const oiDeltaPct = oiAvg > 0 ? (snapshot.openInterest / oiAvg - 1) * 100 : 0
    conditionValues.oiAvg24h = oiAvg
    conditionValues.oiRatio = oiRatio
    conditionValues.oiDeltaPct = oiDeltaPct
    if (oiRatio < OI_MULTIPLIER) {
      return { triggered: false, conditionValues }
    }

    // Condition 3 and 4: the most recent 1h candle must have a wick
    // opposite to the funding bias and close back inside the range.
    const candles = snapshot.candles1h ?? []
    if (candles.length === 0) {
      conditionValues.candleAvailable = false
      return { triggered: false, conditionValues }
    }
    const candle = candles[candles.length - 1]!
    const body = Math.abs(candle.c - candle.o)
    const upperWick = candle.h - Math.max(candle.o, candle.c)
    const lowerWick = Math.min(candle.o, candle.c) - candle.l
    conditionValues.candleOpen = candle.o
    conditionValues.candleHigh = candle.h
    conditionValues.candleLow = candle.l
    conditionValues.candleClose = candle.c
    conditionValues.body = body
    conditionValues.upperWick = upperWick
    conditionValues.lowerWick = lowerWick

    // A zero-body candle (doji) would divide by zero; treat body as a
    // tiny epsilon so the ratio is stable without dropping valid
    // rejections.
    const effectiveBody = Math.max(body, Math.abs(candle.c) * 1e-6, 1e-9)

    let direction: 'long' | 'short'
    let stop: number
    let rejected: boolean

    if (snapshot.funding > 0) {
      // Positive funding: crowd is long, look for an upper wick that
      // rejected into the close. Suggested trade is a short.
      direction = 'short'
      const wickRatio = upperWick / effectiveBody
      conditionValues.wickRatio = wickRatio
      if (wickRatio < WICK_BODY_RATIO) {
        return { triggered: false, conditionValues }
      }
      rejected = candle.c < candle.h
      conditionValues.closedInsideWick = rejected
      if (!rejected) {
        return { triggered: false, conditionValues }
      }
      stop = candle.h * (1 + STOP_BUFFER)
    } else {
      // Negative funding: crowd is short, look for a lower wick that
      // rejected back up. Suggested trade is a long.
      direction = 'long'
      const wickRatio = lowerWick / effectiveBody
      conditionValues.wickRatio = wickRatio
      if (wickRatio < WICK_BODY_RATIO) {
        return { triggered: false, conditionValues }
      }
      rejected = candle.c > candle.l
      conditionValues.closedInsideWick = rejected
      if (!rejected) {
        return { triggered: false, conditionValues }
      }
      stop = candle.l * (1 - STOP_BUFFER)
    }

    const entry = snapshot.markPrice
    const risk = Math.abs(entry - stop)
    const target =
      direction === 'short'
        ? entry - risk * TARGET_R_MULTIPLE
        : entry + risk * TARGET_R_MULTIPLE

    return {
      triggered: true,
      conditionValues,
      suggestedDirection: direction,
      suggestedEntry: entry,
      suggestedStop: stop,
      suggestedTarget: target,
    }
  },
}
