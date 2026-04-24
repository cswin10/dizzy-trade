import type { Framework, FrameworkResult, MarketSnapshot } from './types.ts'
import {
  candleBody,
  candleClosePosition,
  candleLowerWick,
  candleUpperWick,
  mostRecentSwingHigh,
  mostRecentSwingLow,
  rsi,
} from '../technical.ts'

// Framework 2: Mean Reversion
// ---------------------------
// Rationale: A stretched move into a prior swing level (or a round
// number) that prints an RSI divergence on the 4h and a rejection
// candle, with funding stretched in the same direction, is a classic
// mean-reversion setup. The rejection wick marks the stop; the entry
// is the mark price; the target is 2R.
//
// Long setup requires a bullish rejection at support; short setup is
// the mirror at resistance. Long is evaluated first; if it does not
// qualify we fall through to the short checks.
//
// Thresholds:
//   swing_lookback_candles             lookback for swing detection
//   swing_min_age_candles              min age of the swing level
//   level_proximity_pct                how close price must be to level
//   rsi_period                         RSI period
//   rsi_lookback_candles               RSI divergence / breakout lookback
//   rsi_overbought / rsi_oversold      RSI gates
//   rejection_wick_body_ratio          wick / body for rejection candle
//   rejection_close_position_threshold close position in range
//   funding_stretch_long_setup         funding <= for long
//   funding_stretch_short_setup        funding >= for short

const STOP_BUFFER = 0.002
const TARGET_R_MULTIPLE = 2

function stepForPrice(p: number): number {
  const a = Math.abs(p)
  if (a < 1) return 0.01
  if (a < 10) return 0.25
  if (a < 100) return 1
  if (a < 1000) return 10
  return 100
}

function roundBelow(p: number): number {
  const step = stepForPrice(p)
  return Math.floor(p / step) * step
}

function roundAbove(p: number): number {
  const step = stepForPrice(p)
  return Math.ceil(p / step) * step
}

export const meanReversionFramework: Framework = {
  id: 'mean_reversion_v1',
  name: 'Mean reversion',
  description:
    'Rejection at a prior 4h swing level or round number with RSI divergence and stretched funding.',
  dataRequirements: {
    needsCandles4h: true,
  },
  evaluate(
    snapshot: MarketSnapshot,
    thresholds: Record<string, number>,
  ): FrameworkResult {
    const swingLookback = thresholds.swing_lookback_candles!
    const swingMinAge = thresholds.swing_min_age_candles!
    const levelProximity = thresholds.level_proximity_pct!
    const rsiPeriod = thresholds.rsi_period!
    const rsiLookback = thresholds.rsi_lookback_candles!
    const rsiOverbought = thresholds.rsi_overbought!
    const rsiOversold = thresholds.rsi_oversold!
    const rejectionWickRatio = thresholds.rejection_wick_body_ratio!
    const rejectionClosePos = thresholds.rejection_close_position_threshold!
    const fundingStretchLong = thresholds.funding_stretch_long_setup!
    const fundingStretchShort = thresholds.funding_stretch_short_setup!

    const conditionValues: Record<string, number | string | boolean> = {
      funding: snapshot.funding,
    }

    const candles = snapshot.candles4h ?? []
    const minNeeded = Math.max(
      rsiPeriod + 2,
      rsiLookback + 1,
      swingLookback + 1,
    )
    if (candles.length < minNeeded) {
      conditionValues.candleCount = candles.length
      return { triggered: false, conditionValues }
    }

    const current = candles[candles.length - 1]!
    const closes = candles.map((c) => c.c)
    const currentRsi = rsi(closes, rsiPeriod)
    conditionValues.rsi = currentRsi
    conditionValues.markPrice = snapshot.markPrice

    // ============================== LONG ==============================
    const longSwing = mostRecentSwingLow(candles, swingLookback, swingMinAge)
    const rBelow = roundBelow(snapshot.markPrice)
    const nearSwingLong =
      longSwing !== null &&
      Math.abs(snapshot.markPrice - longSwing.price) / snapshot.markPrice <=
        levelProximity
    const nearRoundLong =
      rBelow > 0 &&
      Math.abs(snapshot.markPrice - rBelow) / snapshot.markPrice <=
        levelProximity
    conditionValues.longSwingLevel = longSwing ? longSwing.price : 0
    conditionValues.longRoundBelow = rBelow
    conditionValues.longNearLevel = nearSwingLong || nearRoundLong

    if (nearSwingLong || nearRoundLong) {
      // Current candle must print a new 20-candle price low.
      let lowestPrior = Infinity
      for (
        let i = Math.max(0, candles.length - rsiLookback);
        i < candles.length - 1;
        i++
      ) {
        const lo = candles[i]!.l
        if (lo < lowestPrior) lowestPrior = lo
      }
      const makesNewLow = current.l <= lowestPrior
      conditionValues.longMakesNewLow = makesNewLow

      // RSI divergence: RSI at the most recent prior swing low inside
      // the divergence lookback must be below currentRsi.
      const divSwing = mostRecentSwingLow(candles, rsiLookback, 1)
      let bullishDivergence = false
      if (divSwing !== null) {
        const closesAtSwing = closes.slice(0, divSwing.index + 1)
        const swingRsi = rsi(closesAtSwing, rsiPeriod)
        conditionValues.longSwingRsi = swingRsi
        if (Number.isFinite(swingRsi) && Number.isFinite(currentRsi)) {
          bullishDivergence = currentRsi > swingRsi
        }
      }
      conditionValues.longBullishDivergence = bullishDivergence

      const rsiOk = Number.isFinite(currentRsi) && currentRsi < rsiOversold

      // Rejection candle: lower wick dominates, bullish close, close
      // in the upper portion of the range.
      const body = candleBody(current)
      const lowerWick = candleLowerWick(current)
      const closePos = candleClosePosition(current)
      const effectiveBody = Math.max(body, Math.abs(current.c) * 1e-6, 1e-9)
      const wickRatio = lowerWick / effectiveBody
      const bullishCandle = current.c > current.o
      const closePosOk = closePos >= rejectionClosePos
      const rejection =
        wickRatio > rejectionWickRatio && bullishCandle && closePosOk
      conditionValues.longWickRatio = wickRatio
      conditionValues.longClosePosition = closePos
      conditionValues.longRejection = rejection

      const fundingOk = snapshot.funding <= fundingStretchLong
      conditionValues.longFundingOk = fundingOk

      if (makesNewLow && bullishDivergence && rsiOk && rejection && fundingOk) {
        const entry = snapshot.markPrice
        const stop = current.l * (1 - STOP_BUFFER)
        const risk = entry - stop
        const target = entry + TARGET_R_MULTIPLE * risk
        return {
          triggered: true,
          conditionValues,
          suggestedDirection: 'long',
          suggestedEntry: entry,
          suggestedStop: stop,
          suggestedTarget: target,
        }
      }
    }

    // ============================== SHORT =============================
    const shortSwing = mostRecentSwingHigh(candles, swingLookback, swingMinAge)
    const rAbove = roundAbove(snapshot.markPrice)
    const nearSwingShort =
      shortSwing !== null &&
      Math.abs(snapshot.markPrice - shortSwing.price) / snapshot.markPrice <=
        levelProximity
    const nearRoundShort =
      rAbove > 0 &&
      Math.abs(snapshot.markPrice - rAbove) / snapshot.markPrice <=
        levelProximity
    conditionValues.shortSwingLevel = shortSwing ? shortSwing.price : 0
    conditionValues.shortRoundAbove = rAbove
    conditionValues.shortNearLevel = nearSwingShort || nearRoundShort

    if (nearSwingShort || nearRoundShort) {
      let highestPrior = -Infinity
      for (
        let i = Math.max(0, candles.length - rsiLookback);
        i < candles.length - 1;
        i++
      ) {
        const hi = candles[i]!.h
        if (hi > highestPrior) highestPrior = hi
      }
      const makesNewHigh = current.h >= highestPrior
      conditionValues.shortMakesNewHigh = makesNewHigh

      const divSwing = mostRecentSwingHigh(candles, rsiLookback, 1)
      let bearishDivergence = false
      if (divSwing !== null) {
        const closesAtSwing = closes.slice(0, divSwing.index + 1)
        const swingRsi = rsi(closesAtSwing, rsiPeriod)
        conditionValues.shortSwingRsi = swingRsi
        if (Number.isFinite(swingRsi) && Number.isFinite(currentRsi)) {
          bearishDivergence = currentRsi < swingRsi
        }
      }
      conditionValues.shortBearishDivergence = bearishDivergence

      const rsiOk = Number.isFinite(currentRsi) && currentRsi > rsiOverbought

      const body = candleBody(current)
      const upperWick = candleUpperWick(current)
      const closePos = candleClosePosition(current)
      const effectiveBody = Math.max(body, Math.abs(current.c) * 1e-6, 1e-9)
      const wickRatio = upperWick / effectiveBody
      const bearishCandle = current.c < current.o
      const closePosOk = closePos <= 1 - rejectionClosePos
      const rejection =
        wickRatio > rejectionWickRatio && bearishCandle && closePosOk
      conditionValues.shortWickRatio = wickRatio
      conditionValues.shortClosePosition = closePos
      conditionValues.shortRejection = rejection

      const fundingOk = snapshot.funding >= fundingStretchShort
      conditionValues.shortFundingOk = fundingOk

      if (
        makesNewHigh &&
        bearishDivergence &&
        rsiOk &&
        rejection &&
        fundingOk
      ) {
        const entry = snapshot.markPrice
        const stop = current.h * (1 + STOP_BUFFER)
        const risk = stop - entry
        const target = entry - TARGET_R_MULTIPLE * risk
        return {
          triggered: true,
          conditionValues,
          suggestedDirection: 'short',
          suggestedEntry: entry,
          suggestedStop: stop,
          suggestedTarget: target,
        }
      }
    }

    return { triggered: false, conditionValues }
  },
}
