// Risk-based position sizing for strategy alerts.
//
// Given the strategy's GBP risk per trade, the entry, and the stop,
// we work back to a position size in the base asset and the implied
// notional and leverage. Coin amounts are rounded by price tier so
// the user gets a copy-pasteable size rather than a 12-decimal float.

export type SizingInput = {
  entry: number
  stop: number
  riskGbp: number
  gbpUsdRate: number
}

export type SizingResult = {
  positionSizeCoin: number
  positionSizeUsd: number
  leverageImplied: number
  riskUsd: number
}

// Decimals for the base-asset position. BTC/ETH end up with 4dp,
// mid-cap coins with 2dp, sub-dollar memecoins with whole units.
function decimalsForPrice(price: number): number {
  const abs = Math.abs(price)
  if (abs >= 1000) return 4
  if (abs >= 10) return 2
  if (abs >= 1) return 1
  return 0
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Compute position size, notional, and implied leverage from a
 * GBP risk amount and an entry/stop pair.
 *
 * @example
 *   computeSizing({ entry: 67245, stop: 66920, riskGbp: 30, gbpUsdRate: 1.27 })
 *   // -> { positionSizeCoin: 0.1172, positionSizeUsd: 7881.12,
 *   //      leverageImplied: 207.0, riskUsd: 38.1 }
 */
export function computeSizing(input: SizingInput): SizingResult {
  const riskUsd = input.riskGbp * input.gbpUsdRate
  const stopDistanceUsd = Math.abs(input.entry - input.stop)
  if (stopDistanceUsd <= 0 || riskUsd <= 0 || input.entry <= 0) {
    return {
      positionSizeCoin: 0,
      positionSizeUsd: 0,
      leverageImplied: 0,
      riskUsd,
    }
  }
  const rawCoin = riskUsd / stopDistanceUsd
  const positionSizeCoin = roundTo(rawCoin, decimalsForPrice(input.entry))
  const positionSizeUsd = positionSizeCoin * input.entry
  const leverageImplied = riskUsd > 0 ? positionSizeUsd / riskUsd : 0
  return {
    positionSizeCoin,
    positionSizeUsd,
    leverageImplied,
    riskUsd,
  }
}
