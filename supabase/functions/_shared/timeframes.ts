// Timeframe helpers for strategy candle alignment.
//
// All Hyperliquid candles align to UTC boundaries on intervals that
// divide the day evenly, so a Unix timestamp rounded up to the next
// multiple of the interval gives the next candle close.
//
// If `now` lands exactly on a boundary, the candle that opened at
// that boundary closes one full interval later.

export type Timeframe = '15m' | '1h' | '4h' | '1d'

const INTERVAL_MS: Record<Timeframe, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
}

/**
 * Returns the close time of the candle currently open at `now`.
 *
 * @example
 *   nextCandleClose('1h', new Date('2026-04-25T13:42:11Z'))
 *   // -> Date('2026-04-25T14:00:00Z')
 *   nextCandleClose('1h', new Date('2026-04-25T13:00:00Z'))
 *   // -> Date('2026-04-25T14:00:00Z')
 */
export function nextCandleClose(
  timeframe: Timeframe,
  now: Date = new Date(),
): Date {
  const ms = now.getTime()
  const interval = INTERVAL_MS[timeframe]
  const ceiling = Math.ceil(ms / interval) * interval
  const next = ceiling > ms ? ceiling : ceiling + interval
  return new Date(next)
}
