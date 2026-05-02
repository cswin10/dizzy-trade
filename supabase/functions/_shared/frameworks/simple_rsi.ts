import type { Framework, FrameworkResult, MarketSnapshot } from './types.ts'
import { rsi } from '../technical.ts'

// Simple RSI framework. Pure debug strategy: long when RSI(period)
// drops below the oversold threshold, short when it pushes above
// overbought. No swing levels, no funding gate, no volume, no
// divergence, no rejection wicks. Use it to sanity-check the
// backtest engine produces signals when given permissive
// conditions, and as a baseline when discovering parameters for
// richer frameworks.
//
// Stops and targets are fixed percentage offsets from the entry,
// configurable via thresholds (defaults: 1% stop, 2% target = 1:2 RR).

const FALLBACK = {
  rsi_period: 14,
  rsi_oversold: 30,
  rsi_overbought: 70,
  stop_pct: 1.0,
  target_pct: 2.0,
}

export const simpleRsiFramework: Framework = {
  id: 'simple_rsi_v1',
  name: 'Simple RSI',
  description:
    'RSI extremes only, no other filters. Use for engine validation and parameter discovery.',
  dataRequirements: {
    needsCandles: true,
  },
  evaluate(
    snapshot: MarketSnapshot,
    thresholds: Record<string, number>,
  ): FrameworkResult {
    const rsiPeriod = thresholds.rsi_period ?? FALLBACK.rsi_period
    const rsiOversold = thresholds.rsi_oversold ?? FALLBACK.rsi_oversold
    const rsiOverbought = thresholds.rsi_overbought ?? FALLBACK.rsi_overbought
    const stopPct = thresholds.stop_pct ?? FALLBACK.stop_pct
    const targetPct = thresholds.target_pct ?? FALLBACK.target_pct

    const conditionValues: Record<string, number | string | boolean> = {}

    const candles = snapshot.candles ?? []
    if (candles.length < rsiPeriod + 1) {
      conditionValues.candleCount = candles.length
      return { triggered: false, conditionValues }
    }

    const closes = candles.map((c) => c.c)
    const currentRsi = rsi(closes, rsiPeriod)
    conditionValues.rsi = currentRsi
    conditionValues.markPrice = snapshot.markPrice

    if (!Number.isFinite(currentRsi)) {
      return { triggered: false, conditionValues }
    }

    const isLong = currentRsi < rsiOversold
    const isShort = currentRsi > rsiOverbought

    // Sensible thresholds (oversold < overbought) make this branch
    // unreachable, but guard anyway: ambiguous signal = no signal.
    if (isLong && isShort) {
      return { triggered: false, conditionValues }
    }

    if (!isLong && !isShort) {
      return { triggered: false, conditionValues }
    }

    const entry = snapshot.markPrice
    const direction: 'long' | 'short' = isLong ? 'long' : 'short'
    const stop =
      direction === 'long'
        ? entry * (1 - stopPct / 100)
        : entry * (1 + stopPct / 100)
    const target =
      direction === 'long'
        ? entry * (1 + targetPct / 100)
        : entry * (1 - targetPct / 100)

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
