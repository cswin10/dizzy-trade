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
//
// Uses two separate `.ilike()` queries in parallel and merges the result
// client-side. An earlier attempt used `.or('symbol.ilike.x,name.ilike.y')`
// but PostgREST's filter-string grammar is finicky about wildcards inside
// OR expressions (`%` vs `*` depending on version), and silently returned
// zero rows under the current Supabase version. Two direct `.ilike()`
// calls avoid that minefield entirely.
export async function searchAssets(query: string): Promise<AssetResult[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const [symbolMatches, nameMatches] = await Promise.all([
    supabase
      .from('assets_reference')
      .select('coingecko_id, symbol, name, market_cap_rank')
      .ilike('symbol', `${trimmed}%`)
      .order('market_cap_rank', { ascending: true, nullsFirst: false })
      .limit(MAX_RESULTS),
    supabase
      .from('assets_reference')
      .select('coingecko_id, symbol, name, market_cap_rank')
      .ilike('name', `%${trimmed}%`)
      .order('market_cap_rank', { ascending: true, nullsFirst: false })
      .limit(MAX_RESULTS),
  ])

  if (symbolMatches.error) {
    console.error(
      '[searchAssets] symbol query failed:',
      symbolMatches.error.message,
    )
  }
  if (nameMatches.error) {
    console.error(
      '[searchAssets] name query failed:',
      nameMatches.error.message,
    )
  }

  const seen = new Set<string>()
  const merged: AssetResult[] = []
  for (const row of symbolMatches.data ?? []) {
    if (seen.has(row.coingecko_id)) continue
    seen.add(row.coingecko_id)
    merged.push(row as AssetResult)
  }
  for (const row of nameMatches.data ?? []) {
    if (seen.has(row.coingecko_id)) continue
    seen.add(row.coingecko_id)
    merged.push(row as AssetResult)
  }

  merged.sort((a, b) => {
    const ar = a.market_cap_rank
    const br = b.market_cap_rank
    if (ar === null && br === null) return 0
    if (ar === null) return 1
    if (br === null) return -1
    return ar - br
  })

  const limited = merged.slice(0, MAX_RESULTS)
  console.log(
    `[searchAssets] query="${trimmed}" symbol=${symbolMatches.data?.length ?? 0} name=${nameMatches.data?.length ?? 0} merged=${limited.length}`,
  )
  return limited
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
