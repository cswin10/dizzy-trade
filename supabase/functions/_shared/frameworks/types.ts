import type { Candle } from '../hyperliquid.ts'

export type NarrativeHeat = 'hot' | 'warm' | 'cool' | 'cold'

export type MarketSnapshot = {
  symbol: string
  markPrice: number
  funding: number
  openInterest: number
  dayNotionalVolume: number
  candles1h?: Candle[]
  candles4h?: Candle[]
  fundingHistory?: number[]
  oiHistory?: number[]
  narrativeHeat?: NarrativeHeat
  btcReturn24h?: number
}

export type FrameworkResult = {
  triggered: boolean
  conditionValues: Record<string, number | string | boolean>
  suggestedDirection?: 'long' | 'short'
  suggestedEntry?: number
  suggestedStop?: number
  suggestedTarget?: number
}

export type DataRequirements = {
  needsCandles1h?: boolean
  needsCandles4h?: boolean
  needsFundingHistory?: boolean
  needsOiHistory?: boolean
  needsNarrativeHeat?: boolean
  needsBtcReturn24h?: boolean
}

export type Framework = {
  id: string
  name: string
  description: string
  dataRequirements: DataRequirements
  evaluate(
    snapshot: MarketSnapshot,
    thresholds: Record<string, number>,
  ): FrameworkResult
}
