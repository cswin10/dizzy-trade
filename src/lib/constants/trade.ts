// Single source of truth for the trade taxonomy. Both the validation
// schemas and the form pickers consume these arrays so that adding a new
// narrative or setup is a one-line change.

export const NARRATIVE_TAGS = [
  'AI agents',
  'RWA',
  'L2s',
  'DePIN',
  'Memecoins',
  'Majors (BTC/ETH)',
  'Stablecoin yield',
  'Gaming',
  'Privacy',
  'Mixed',
  'Other',
] as const

export type NarrativeTag = (typeof NARRATIVE_TAGS)[number]

export const SETUP_TYPES = [
  'Narrative breakout',
  'Liquidation hunt',
  'Mean reversion',
  'News event',
  'Swing',
  'Scalp',
  'Other',
] as const

export type SetupType = (typeof SETUP_TYPES)[number]

export const VENUE_SUGGESTIONS = [
  'Hyperliquid',
  'Coinbase',
  'Binance',
  'Uniswap',
  'Kraken',
  'Aerodrome',
  'Jupiter',
  'On-chain',
] as const

export const TIME_FILTERS = ['all', '30d', '90d', 'ytd'] as const
export type TimeFilter = (typeof TIME_FILTERS)[number]

export const OUTCOMES = ['all', 'win', 'loss', 'breakeven', 'open'] as const
export type OutcomeFilter = (typeof OUTCOMES)[number]
