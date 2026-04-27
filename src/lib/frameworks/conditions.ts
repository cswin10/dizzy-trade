import type { FrameworkResult } from './types'

export type FrameworkChip = {
  // Short label, shown above or before the value (e.g. "RSI", "Funding").
  label: string
  // Current value as already-formatted text (e.g. "28.4", "0.045%").
  value: string
  // Whether this condition currently passes the framework's gate.
  passed: boolean
  // Long-form explanation surfaced in a hover tooltip.
  tooltip: string
}

export type FrameworkChipBreakdown = {
  chips: FrameworkChip[]
  metCount: number
  totalCount: number
  // True when the framework would fire an alert this candle.
  wouldTrigger: boolean
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function asBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  return null
}

function fmtNum(value: number | null, digits = 2): string {
  if (value == null) return 'n/a'
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function fmtPct(value: number | null, digits = 2): string {
  if (value == null) return 'n/a'
  return `${(value * 100).toFixed(digits)}%`
}

// Translates a framework's evaluation result into chip-ready data for
// the watchlist UI. Each framework has its own mapper because the
// conditionValues shape and what counts as "a single human-readable
// gate" varies. If the framework returns triggered=true we know all
// chips passed; otherwise we test each chip's predicate independently
// so the user sees how close they are to a fire.

export function buildMeanReversionChips(
  result: FrameworkResult,
  thresholds: Record<string, number>,
): FrameworkChipBreakdown {
  const cv = result.conditionValues
  const longSetup = asBool(cv.longNearLevel) === true
  const shortSetup = asBool(cv.shortNearLevel) === true
  const useShort = shortSetup && !longSetup
  const prefix = useShort ? 'short' : 'long'

  const rsiVal = asNumber(cv.rsi)
  const rsiOversold = thresholds.rsi_oversold
  const rsiOverbought = thresholds.rsi_overbought
  const rsiPasses = useShort
    ? rsiVal != null && rsiOverbought != null && rsiVal > rsiOverbought
    : rsiVal != null && rsiOversold != null && rsiVal < rsiOversold

  const nearLevel = asBool(cv[`${prefix}NearLevel`]) === true
  const divergence =
    asBool(cv[`${prefix}${useShort ? 'Bearish' : 'Bullish'}Divergence`]) ===
    true
  const newExtreme =
    asBool(cv[`${prefix}${useShort ? 'MakesNewHigh' : 'MakesNewLow'}`]) === true
  const rejection = asBool(cv[`${prefix}Rejection`]) === true
  const fundingOk = asBool(cv[`${prefix}FundingOk`]) === true

  const chips: FrameworkChip[] = [
    {
      label: 'Near level',
      value: nearLevel ? 'yes' : 'no',
      passed: nearLevel,
      tooltip:
        'Price is within the configured proximity of a recent 4h swing or round number.',
    },
    {
      label: 'RSI',
      value: fmtNum(rsiVal, 1),
      passed: rsiPasses,
      tooltip: useShort
        ? `RSI must be above ${rsiOverbought ?? 'overbought'} for a short setup.`
        : `RSI must be below ${rsiOversold ?? 'oversold'} for a long setup.`,
    },
    {
      label: 'Divergence',
      value: divergence ? 'yes' : 'no',
      passed: divergence,
      tooltip: useShort
        ? 'Bearish RSI divergence: lower swing high in RSI versus the prior swing.'
        : 'Bullish RSI divergence: higher swing low in RSI versus the prior swing.',
    },
    {
      label: useShort ? 'New high' : 'New low',
      value: newExtreme ? 'yes' : 'no',
      passed: newExtreme,
      tooltip: 'Current candle prints a new extreme over the lookback window.',
    },
    {
      label: 'Rejection',
      value: rejection ? 'yes' : 'no',
      passed: rejection,
      tooltip:
        'Wick dominates the body and the close lands deep on the opposite side.',
    },
    {
      label: 'Funding',
      value: fmtPct(asNumber(cv.funding), 4),
      passed: fundingOk,
      tooltip: useShort
        ? 'Funding must be stretched positive (longs paying).'
        : 'Funding must be stretched negative (shorts paying).',
    },
  ]

  const metCount = chips.filter((c) => c.passed).length
  return {
    chips,
    metCount,
    totalCount: chips.length,
    wouldTrigger: result.triggered,
  }
}

export function buildNarrativeBreakoutChips(
  result: FrameworkResult,
  thresholds: Record<string, number>,
): FrameworkChipBreakdown {
  const cv = result.conditionValues
  const heat = typeof cv.heat === 'string' ? cv.heat : 'unknown'
  const heatOk = heat === 'hot'

  const breakoutLevel = asNumber(cv.breakout_level)
  const currentClose = asNumber(cv.current_close)
  const breakoutOk =
    breakoutLevel != null &&
    currentClose != null &&
    currentClose > breakoutLevel

  const volumeRatio = asNumber(cv.volume_ratio)
  const volumeOk =
    volumeRatio != null &&
    thresholds.volume_multiplier != null &&
    volumeRatio > thresholds.volume_multiplier

  const outperformance = asNumber(cv.outperformance)
  const outperformanceOk =
    outperformance != null &&
    thresholds.btc_outperformance_24h != null &&
    outperformance >= thresholds.btc_outperformance_24h

  const funding = asNumber(cv.funding)
  const fundingOk =
    funding != null &&
    thresholds.funding_min_hourly != null &&
    thresholds.funding_max_hourly != null &&
    funding > thresholds.funding_min_hourly &&
    funding < thresholds.funding_max_hourly

  const chips: FrameworkChip[] = [
    {
      label: 'Heat',
      value: heat.toUpperCase(),
      passed: heatOk,
      tooltip:
        'Symbol must be tagged as a hot narrative. Set heat in Settings → Narratives.',
    },
    {
      label: 'Breakout',
      value:
        breakoutLevel != null
          ? `vs ${fmtNum(breakoutLevel, breakoutLevel < 10 ? 4 : 2)}`
          : 'n/a',
      passed: breakoutOk,
      tooltip:
        'Current close must clear the highest high of the prior lookback window.',
    },
    {
      label: 'Volume',
      value: volumeRatio != null ? `${fmtNum(volumeRatio, 2)}×` : 'n/a',
      passed: volumeOk,
      tooltip: `Current volume must exceed ${thresholds.volume_multiplier ?? '?'}× the SMA20 of recent volume.`,
    },
    {
      label: 'Outperf',
      value: fmtPct(outperformance, 2),
      passed: outperformanceOk,
      tooltip: `Asset 24h return minus BTC 24h return must clear ${fmtPct(thresholds.btc_outperformance_24h ?? null, 2)}.`,
    },
    {
      label: 'Funding',
      value: fmtPct(funding, 4),
      passed: fundingOk,
      tooltip: `Funding must sit between ${fmtPct(thresholds.funding_min_hourly ?? null, 4)} and ${fmtPct(thresholds.funding_max_hourly ?? null, 4)}.`,
    },
  ]
  const metCount = chips.filter((c) => c.passed).length
  return {
    chips,
    metCount,
    totalCount: chips.length,
    wouldTrigger: result.triggered,
  }
}

export function buildLiquidationHuntChips(
  result: FrameworkResult,
  thresholds: Record<string, number>,
): FrameworkChipBreakdown {
  const cv = result.conditionValues
  const absFunding = asNumber(cv.absFunding)
  const fundingOk =
    absFunding != null &&
    thresholds.funding_threshold != null &&
    absFunding > thresholds.funding_threshold

  const oiRatio = asNumber(cv.oiRatio)
  const oiDeltaPct = asNumber(cv.oiDeltaPct)
  const oiOk =
    oiRatio != null &&
    thresholds.oi_elevation_multiplier != null &&
    oiRatio >= thresholds.oi_elevation_multiplier

  const wickRatio = asNumber(cv.wickRatio)
  const wickOk =
    wickRatio != null &&
    thresholds.wick_to_body_ratio != null &&
    wickRatio >= thresholds.wick_to_body_ratio

  const rejected = asBool(cv.closedInsideWick) === true

  const chips: FrameworkChip[] = [
    {
      label: 'Funding extreme',
      value: fmtPct(asNumber(cv.funding), 4),
      passed: fundingOk,
      tooltip: `Absolute funding must exceed ${fmtPct(thresholds.funding_threshold ?? null, 4)}.`,
    },
    {
      label: 'OI elevated',
      value:
        oiDeltaPct != null
          ? `${oiDeltaPct >= 0 ? '+' : ''}${fmtNum(oiDeltaPct, 1)}%`
          : 'n/a',
      passed: oiOk,
      tooltip: `Open interest must be at least ${thresholds.oi_elevation_multiplier ?? '?'}× the 24h rolling average.`,
    },
    {
      label: 'Wick',
      value: wickRatio != null ? `${fmtNum(wickRatio, 2)}× body` : 'n/a',
      passed: wickOk,
      tooltip: `Rejection wick must be at least ${thresholds.wick_to_body_ratio ?? '?'}× the candle body.`,
    },
    {
      label: 'Inside close',
      value: rejected ? 'yes' : 'no',
      passed: rejected,
      tooltip: 'Candle close must land inside the wick (rejection confirmed).',
    },
  ]
  const metCount = chips.filter((c) => c.passed).length
  return {
    chips,
    metCount,
    totalCount: chips.length,
    wouldTrigger: result.triggered,
  }
}

export function buildChipsFor(
  frameworkId: string,
  result: FrameworkResult,
  thresholds: Record<string, number>,
): FrameworkChipBreakdown {
  if (frameworkId === 'mean_reversion_v1') {
    return buildMeanReversionChips(result, thresholds)
  }
  if (frameworkId === 'narrative_breakout_v1') {
    return buildNarrativeBreakoutChips(result, thresholds)
  }
  if (frameworkId === 'liquidation_hunt_v1') {
    return buildLiquidationHuntChips(result, thresholds)
  }
  // Unknown framework: surface an empty breakdown so the caller can
  // skip rendering rather than crash.
  return { chips: [], metCount: 0, totalCount: 0, wouldTrigger: false }
}
