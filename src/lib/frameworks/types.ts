// Node mirror of supabase/functions/_shared/frameworks/types.ts. Same
// shapes so frameworks evaluate identically in the scanner runtime
// and in app-side server components (the watchlist page reuses these
// to render readiness cards).

import type { Candle } from '@/lib/hyperliquid'

export type NarrativeHeat = 'hot' | 'warm' | 'cool' | 'cold'

export type MarketSnapshot = {
  symbol: string
  markPrice: number
  funding: number
  openInterest: number
  dayNotionalVolume: number
  candles?: Candle[]
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
  needsCandles?: boolean
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
