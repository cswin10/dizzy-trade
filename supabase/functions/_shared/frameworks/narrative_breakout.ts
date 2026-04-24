import type { Framework, FrameworkResult, MarketSnapshot } from './types.ts'
import { sma } from '../technical.ts'

// Framework 1: Narrative Breakout
// -------------------------------
// Rationale: A symbol tagged as "hot" narrative that breaks out above a
// 20-candle 4h range on elevated volume, while outperforming BTC over
// the last 24h and with funding in a healthy band (positive but not
// overheated), is a high-conviction trend continuation setup. Heat
// numeric thresholds (heat_score_absolute, heat_delta_6h) stay dormant
// until a news module writes them; for now the categorical
// narrativeHeat === 'hot' stands in.
//
// Thresholds:
//   breakout_lookback_candles   number of prior 4h candles for level
//   volume_multiplier           volume / SMA20 floor
//   btc_outperformance_24h      asset return minus BTC return floor
//   funding_min_hourly          funding floor
//   funding_max_hourly          funding ceiling
//
// Stop and target are fixed: 0.5% below the breakout level and 2R.

const STOP_BUFFER = 0.005
const TARGET_R_MULTIPLE = 2

export const narrativeBreakoutFramework: Framework = {
  id: 'narrative_breakout_v1',
  name: 'Narrative breakout',
  description:
    'Hot narrative symbol breaking a 20-candle 4h range on volume with BTC outperformance.',
  dataRequirements: {
    needsCandles4h: true,
    needsNarrativeHeat: true,
    needsBtcReturn24h: true,
  },
  evaluate(
    snapshot: MarketSnapshot,
    thresholds: Record<string, number>,
  ): FrameworkResult {
    const lookback = thresholds.breakout_lookback_candles!
    const volumeMultiplier = thresholds.volume_multiplier!
    const outperformanceFloor = thresholds.btc_outperformance_24h!
    const fundingMin = thresholds.funding_min_hourly!
    const fundingMax = thresholds.funding_max_hourly!

    const conditionValues: Record<string, number | string | boolean> = {
      heat: snapshot.narrativeHeat ?? 'unknown',
      funding: snapshot.funding,
    }

    // Condition 1: narrative tag must be hot. Heat numeric thresholds
    // (heat_score_absolute, heat_delta_6h) are dormant until the news
    // module ships.
    if (snapshot.narrativeHeat !== 'hot') {
      return { triggered: false, conditionValues }
    }

    // Condition 2a: breakout above the high of the previous `lookback`
    // candles. Needs lookback + 1 candles so we can separate "previous"
    // from the current closed candle.
    const candles = snapshot.candles4h ?? []
    if (candles.length < lookback + 1) {
      conditionValues.candleCount = candles.length
      return { triggered: false, conditionValues }
    }
    const current = candles[candles.length - 1]!
    const priors = candles.slice(
      candles.length - 1 - lookback,
      candles.length - 1,
    )
    let breakoutLevel = priors[0]!.h
    for (const c of priors) {
      if (c.h > breakoutLevel) breakoutLevel = c.h
    }
    conditionValues.breakout_level = breakoutLevel
    conditionValues.current_close = current.c
    if (current.c <= breakoutLevel) {
      return { triggered: false, conditionValues }
    }

    // Condition 2b: volume above volume_multiplier * SMA20 of the
    // previous `lookback` candles' volumes.
    const priorVolumes = priors.map((c) => c.v)
    const volumeSma = sma(priorVolumes, lookback)
    const volumeRatio = volumeSma > 0 ? current.v / volumeSma : 0
    conditionValues.volume_ratio = volumeRatio
    if (!(volumeRatio > volumeMultiplier)) {
      return { triggered: false, conditionValues }
    }

    // Condition 3: asset 24h return minus BTC 24h return must clear
    // the outperformance floor. 24h on 4h candles is 6 bars back.
    if (snapshot.btcReturn24h === undefined) {
      conditionValues.btcReturnAvailable = false
      return { triggered: false, conditionValues }
    }
    if (candles.length < 7) {
      conditionValues.candleCount = candles.length
      return { triggered: false, conditionValues }
    }
    const ref = candles[candles.length - 7]!
    const assetReturn24h = ref.c > 0 ? (current.c - ref.c) / ref.c : 0
    const outperformance = assetReturn24h - snapshot.btcReturn24h
    conditionValues.asset_return_24h = assetReturn24h
    conditionValues.btc_return_24h = snapshot.btcReturn24h
    conditionValues.outperformance = outperformance
    if (outperformance < outperformanceFloor) {
      return { triggered: false, conditionValues }
    }

    // Condition 4: funding in the healthy band (positive but not hot).
    if (!(snapshot.funding > fundingMin && snapshot.funding < fundingMax)) {
      return { triggered: false, conditionValues }
    }

    const entry = snapshot.markPrice
    const stop = breakoutLevel * (1 - STOP_BUFFER)
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
  },
}
