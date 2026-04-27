import type { Framework, FrameworkResult, MarketSnapshot } from './types'

// Node mirror of supabase/functions/_shared/frameworks/liquidation_hunt.ts.
// Logic is identical; only the import path changes.

export const liquidationHuntFramework: Framework = {
  id: 'liquidation_hunt_v1',
  name: 'Liquidation hunt',
  description:
    'Extreme funding plus elevated open interest plus a rejected wick opposite to the funding bias.',
  dataRequirements: {
    needsCandles: true,
    needsFundingHistory: false,
    needsOiHistory: true,
  },
  evaluate(
    snapshot: MarketSnapshot,
    thresholds: Record<string, number>,
  ): FrameworkResult {
    const fundingThreshold = thresholds.funding_threshold!
    const oiMultiplier = thresholds.oi_elevation_multiplier!
    const wickBodyRatio = thresholds.wick_to_body_ratio!
    const stopBuffer = thresholds.stop_buffer!
    const targetRMultiple = thresholds.target_rr_multiple!

    const conditionValues: Record<string, number | string | boolean> = {
      funding: snapshot.funding,
      openInterest: snapshot.openInterest,
    }

    const absFunding = Math.abs(snapshot.funding)
    conditionValues.absFunding = absFunding
    conditionValues.fundingThreshold = fundingThreshold
    if (absFunding <= fundingThreshold) {
      return { triggered: false, conditionValues }
    }

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
    if (oiRatio < oiMultiplier) {
      return { triggered: false, conditionValues }
    }

    const candles = snapshot.candles ?? []
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

    const effectiveBody = Math.max(body, Math.abs(candle.c) * 1e-6, 1e-9)

    let direction: 'long' | 'short'
    let stop: number
    let rejected: boolean

    if (snapshot.funding > 0) {
      direction = 'short'
      const wickRatio = upperWick / effectiveBody
      conditionValues.wickRatio = wickRatio
      if (wickRatio < wickBodyRatio) {
        return { triggered: false, conditionValues }
      }
      rejected = candle.c < candle.h
      conditionValues.closedInsideWick = rejected
      if (!rejected) {
        return { triggered: false, conditionValues }
      }
      stop = candle.h * (1 + stopBuffer)
    } else {
      direction = 'long'
      const wickRatio = lowerWick / effectiveBody
      conditionValues.wickRatio = wickRatio
      if (wickRatio < wickBodyRatio) {
        return { triggered: false, conditionValues }
      }
      rejected = candle.c > candle.l
      conditionValues.closedInsideWick = rejected
      if (!rejected) {
        return { triggered: false, conditionValues }
      }
      stop = candle.l * (1 - stopBuffer)
    }

    const entry = snapshot.markPrice
    const risk = Math.abs(entry - stop)
    const target =
      direction === 'short'
        ? entry - risk * targetRMultiple
        : entry + risk * targetRMultiple

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
