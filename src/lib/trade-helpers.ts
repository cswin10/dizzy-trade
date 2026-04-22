import type { Database } from '@/types/database'

export type Trade = Database['public']['Tables']['trades']['Row']
export type Direction = 'long' | 'short'
export type Outcome = 'win' | 'loss' | 'breakeven' | 'open'

export function computeTradePnl(
  direction: Direction,
  entryPrice: number,
  exitSize: number,
  exitPrice: number,
): number {
  const sign = direction === 'long' ? 1 : -1
  return (exitPrice - entryPrice) * exitSize * sign
}

export function outcomeForPnl(pnl: number): Exclude<Outcome, 'open'> {
  if (pnl > 0) return 'win'
  if (pnl < 0) return 'loss'
  return 'breakeven'
}

export function formatPnl(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0.00'
  const fixed = Math.abs(value).toFixed(2)
  return value < 0 ? `-${fixed}` : fixed
}

export function pnlTone(
  value: number | null | undefined,
): 'positive' | 'negative' | 'neutral' {
  if (value === null || value === undefined || value === 0) return 'neutral'
  return value > 0 ? 'positive' : 'negative'
}
