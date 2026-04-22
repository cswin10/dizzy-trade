'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export type AssetResult = {
  coingecko_id: string
  symbol: string
  name: string
  market_cap_rank: number | null
}

const MAX_RESULTS = 20
const POPULAR_LIMIT = 12

// Auth gate: asset queries are only for signed-in users. The actual read
// goes through the service client so any quirk in role grants or PostgREST
// OR-string parsing can't cause the picker to silently return zero rows.
// assets_reference is declared public reference data with no RLS, so there
// is no tenant filtering to lose.
async function requireUser(): Promise<boolean> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return Boolean(user)
}

function sortByRank(a: AssetResult, b: AssetResult): number {
  const ar = a.market_cap_rank
  const br = b.market_cap_rank
  if (ar === null && br === null) return 0
  if (ar === null) return 1
  if (br === null) return -1
  return ar - br
}

// Searches by symbol prefix and name substring in parallel and merges
// the results client-side. Two direct `.ilike()` calls are used because
// PostgREST's filter-string grammar around wildcards inside `.or()` is
// brittle across versions and previously returned zero rows here.
export async function searchAssets(query: string): Promise<AssetResult[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []
  if (!(await requireUser())) return []

  const service = createServiceClient()

  const [symbolMatches, nameMatches] = await Promise.all([
    service
      .from('assets_reference')
      .select('coingecko_id, symbol, name, market_cap_rank')
      .ilike('symbol', `${trimmed}%`)
      .order('market_cap_rank', { ascending: true, nullsFirst: false })
      .limit(MAX_RESULTS),
    service
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

  merged.sort(sortByRank)

  const limited = merged.slice(0, MAX_RESULTS)
  console.log(
    `[searchAssets] query="${trimmed}" symbol=${symbolMatches.data?.length ?? 0} name=${nameMatches.data?.length ?? 0} merged=${limited.length}`,
  )
  return limited
}

// Top-ranked assets used as suggestions when the picker has focus but the
// user has not typed anything yet. Same permissions story as searchAssets:
// auth-gated, read via service client.
export async function popularAssets(): Promise<AssetResult[]> {
  if (!(await requireUser())) return []

  const service = createServiceClient()
  const { data, error } = await service
    .from('assets_reference')
    .select('coingecko_id, symbol, name, market_cap_rank')
    .not('market_cap_rank', 'is', null)
    .order('market_cap_rank', { ascending: true })
    .limit(POPULAR_LIMIT)

  if (error) {
    console.error('[popularAssets] failed:', error.message)
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
