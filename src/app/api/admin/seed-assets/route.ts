import { NextResponse, type NextRequest } from 'next/server'

import { env } from '@/lib/env'
import { createServiceClient } from '@/lib/supabase/service'

// Admin-only, one-off endpoint that fetches the Coingecko catalogue and
// upserts it into `public.assets_reference`. Protected by a shared secret
// compared against `SEED_TOKEN`. Uses the service role client so it can
// write to the reference table regardless of the caller's auth context.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CoingeckoListRow = {
  id: string
  symbol: string
  name: string
}

type CoingeckoMarketRow = {
  id: string
  market_cap_rank: number | null
}

const BATCH_SIZE = 500
const MARKETS_PAGES = 2
const MARKETS_PER_PAGE = 250

async function fetchList(): Promise<CoingeckoListRow[]> {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/coins/list?include_platform=false',
    { cache: 'no-store' },
  )
  if (!res.ok) {
    throw new Error(
      `Coingecko /coins/list failed: ${res.status} ${res.statusText}`,
    )
  }
  return (await res.json()) as CoingeckoListRow[]
}

async function fetchMarketRanks(): Promise<Map<string, number>> {
  const ranks = new Map<string, number>()
  for (let page = 1; page <= MARKETS_PAGES; page++) {
    const url = new URL('https://api.coingecko.com/api/v3/coins/markets')
    url.searchParams.set('vs_currency', 'usd')
    url.searchParams.set('order', 'market_cap_desc')
    url.searchParams.set('per_page', String(MARKETS_PER_PAGE))
    url.searchParams.set('page', String(page))
    const res = await fetch(url.toString(), { cache: 'no-store' })
    if (!res.ok) {
      console.warn(
        `[seed-assets] /coins/markets page ${page} failed: ${res.status}`,
      )
      break
    }
    const rows = (await res.json()) as CoingeckoMarketRow[]
    for (const row of rows) {
      if (row.id && typeof row.market_cap_rank === 'number') {
        ranks.set(row.id, row.market_cap_rank)
      }
    }
  }
  return ranks
}

export async function GET(request: NextRequest) {
  const token = request.headers.get('x-seed-token')
  if (!env.SEED_TOKEN) {
    return NextResponse.json(
      { error: 'Seed endpoint is disabled (no SEED_TOKEN configured)' },
      { status: 503 },
    )
  }
  if (!token || token !== env.SEED_TOKEN) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  try {
    console.log('[seed-assets] fetching Coingecko catalogue')
    const [list, ranks] = await Promise.all([fetchList(), fetchMarketRanks()])
    console.log(
      `[seed-assets] catalogue=${list.length} rows, ranks=${ranks.size} rows`,
    )

    const supabase = createServiceClient()

    const prepared = list.map((row) => ({
      coingecko_id: row.id,
      symbol: row.symbol.toUpperCase(),
      name: row.name,
      market_cap_rank: ranks.get(row.id) ?? null,
      updated_at: new Date().toISOString(),
    }))

    let written = 0
    for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
      const batch = prepared.slice(i, i + BATCH_SIZE)
      const { error } = await supabase
        .from('assets_reference')
        .upsert(batch, { onConflict: 'coingecko_id' })
      if (error) {
        console.error(
          `[seed-assets] batch ${i / BATCH_SIZE + 1} failed:`,
          error.message,
        )
        return NextResponse.json(
          {
            error: `Upsert failed at batch ${i / BATCH_SIZE + 1}: ${error.message}`,
            written,
          },
          { status: 500 },
        )
      }
      written += batch.length
      console.log(`[seed-assets] upserted ${written}/${prepared.length}`)
    }

    return NextResponse.json({
      ok: true,
      total: prepared.length,
      ranked: ranks.size,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[seed-assets] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
