'use server'

import { createClient } from '@/lib/supabase/server'

export type AssetResult = {
  coingecko_id: string
  symbol: string
  name: string
  market_cap_rank: number | null
}

const MAX_RESULTS = 20

// Server-side asset search. RLS is off for assets_reference (public
// reference data), so any authenticated caller can query. We still use
// the user-scoped server client so that an unauthenticated request would
// fail cleanly.
export async function searchAssets(query: string): Promise<AssetResult[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const symbolPattern = `${trimmed}%`
  const namePattern = `%${trimmed}%`

  const { data, error } = await supabase
    .from('assets_reference')
    .select('coingecko_id, symbol, name, market_cap_rank')
    .or(`symbol.ilike.${symbolPattern},name.ilike.${namePattern}`)
    .order('market_cap_rank', { ascending: true, nullsFirst: false })
    .limit(MAX_RESULTS)

  if (error) {
    console.error('[searchAssets] failed:', error.message)
    return []
  }

  return (data ?? []) as AssetResult[]
}

export type PriceResult = { price: number } | { error: string }

// Fetches the latest USD price for a given Coingecko id. Network or rate
// limit failures are surfaced as `{ error }` so the caller can show a
// warning rather than throwing.
export async function fetchCurrentPrice(
  coingeckoId: string,
): Promise<PriceResult> {
  if (!coingeckoId) return { error: 'Missing asset id' }
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const url = new URL('https://api.coingecko.com/api/v3/simple/price')
  url.searchParams.set('ids', coingeckoId)
  url.searchParams.set('vs_currencies', 'usd')

  try {
    const res = await fetch(url.toString(), { cache: 'no-store' })
    if (!res.ok) {
      return { error: `Coingecko returned ${res.status}` }
    }
    const json = (await res.json()) as Record<
      string,
      { usd?: number } | undefined
    >
    const price = json[coingeckoId]?.usd
    if (typeof price !== 'number' || !Number.isFinite(price)) {
      return { error: 'Price not available for this asset' }
    }
    return { price }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: message }
  }
}
