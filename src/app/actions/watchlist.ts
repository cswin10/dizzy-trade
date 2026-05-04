'use server'

import { revalidatePath } from 'next/cache'

import {
  buildChipsFor,
  type FrameworkChipBreakdown,
} from '@/lib/frameworks/conditions'
import {
  FRAMEWORKS,
  FRAMEWORK_ORDER,
  type MarketSnapshot as FrameworkMarketSnapshot,
} from '@/lib/frameworks'
import {
  getAllMarketData,
  getCandles,
  type Candle,
  type MarketData,
} from '@/lib/hyperliquid'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { rsi, sma } from '@/lib/technical'
import {
  MAJOR_SYMBOLS,
  WATCHLIST_MAX,
  WATCHLIST_MIN,
  updateWatchlistSchema,
} from '@/lib/validations/watchlist'

const CANDLE_LOOKBACK = 50
const OI_HISTORY_LOOKBACK_HOURS = 24
const MAJOR_SET = new Set<string>(MAJOR_SYMBOLS)

export type WatchlistFrameworkView = {
  id: string
  name: string
  breakdown: FrameworkChipBreakdown
}

export type WatchlistMarketContext = {
  funding: number | null
  open_interest: number | null
  volume_24h: number | null
  rsi14: number | null
  sma_distance_pct: number | null
}

export type WatchlistPairView = {
  symbol: string
  narrative_heat: 'hot' | 'warm' | 'cool' | 'cold' | null
  is_major: boolean
  price: number | null
  change_24h_pct: number | null
  has_data: boolean
  context: WatchlistMarketContext
  // Last 20 1h closes for the inline sparkline.
  spark: number[]
  frameworks: WatchlistFrameworkView[]
  // Aggregate readiness score across all frameworks (0..1) used for
  // the readiness sort.
  overall_readiness: number
  // True when at least one framework is firing this candle.
  any_firing: boolean
}

export type WatchlistView = {
  pairs: WatchlistPairView[]
  watchlist_size: number
  watchlist_max: number
  watchlist_min: number
  active_strategy_id: string | null
  active_framework_id: string | null
  fetched_at: string
}

export type WatchlistPrice = {
  symbol: string
  price: number
  change_24h_pct: number | null
  volume_24h: number | null
}

export type UpdateWatchlistResult =
  | { ok: true; selected_count: number }
  | { ok: false; message: string }

async function requireUser(): Promise<boolean> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return Boolean(user)
}

async function loadThresholds(): Promise<Map<string, Record<string, number>>> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('framework_thresholds')
    .select('framework_id, key, value')
  if (error || !data) return new Map()
  const out = new Map<string, Record<string, number>>()
  for (const row of data) {
    const fid = String(row.framework_id)
    const bucket = out.get(fid) ?? {}
    bucket[String(row.key)] = Number(row.value)
    out.set(fid, bucket)
  }
  return out
}

async function loadOiHistory(
  symbols: string[],
): Promise<Map<string, number[]>> {
  if (symbols.length === 0) return new Map()
  const service = createServiceClient()
  const since = new Date(
    Date.now() - OI_HISTORY_LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString()
  const { data, error } = await service
    .from('market_snapshots')
    .select('symbol, open_interest, captured_at')
    .in('symbol', symbols)
    .gte('captured_at', since)
    .order('captured_at', { ascending: true })
  if (error || !data) return new Map()
  const out = new Map<string, number[]>()
  for (const row of data) {
    const oi = row.open_interest
    if (oi == null || !Number.isFinite(Number(oi))) continue
    const sym = String(row.symbol)
    const bucket = out.get(sym) ?? []
    bucket.push(Number(oi))
    out.set(sym, bucket)
  }
  return out
}

async function loadNarrativeTags(): Promise<
  Map<string, 'hot' | 'warm' | 'cool' | 'cold'>
> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('narrative_tags')
    .select('symbol, heat_level')
  if (error || !data) return new Map()
  const out = new Map<string, 'hot' | 'warm' | 'cool' | 'cold'>()
  for (const row of data) {
    const heat = row.heat_level
    if (
      heat === 'hot' ||
      heat === 'warm' ||
      heat === 'cool' ||
      heat === 'cold'
    ) {
      out.set(String(row.symbol), heat)
    }
  }
  return out
}

async function loadActiveStrategy(): Promise<{
  id: string
  framework_id: string
} | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('strategies')
    .select('id, framework_id')
    .eq('deployment_status', 'live')
    .limit(1)
  if (error || !data || data.length === 0) return null
  const row = data[0]!
  return { id: String(row.id), framework_id: String(row.framework_id) }
}

function computeChange24h(candles: Candle[]): number | null {
  if (candles.length < 25) return null
  const last = candles[candles.length - 1]!
  const ref = candles[candles.length - 25]!
  if (ref.c <= 0) return null
  return (last.c - ref.c) / ref.c
}

function computeContext(
  market: MarketData | undefined,
  candles: Candle[],
): WatchlistMarketContext {
  const closes = candles.map((c) => c.c)
  const rsiValue = closes.length >= 16 ? rsi(closes, 14) : NaN
  const smaValue = closes.length >= 20 ? sma(closes, 20) : NaN
  const last = closes[closes.length - 1]
  const smaDistance =
    Number.isFinite(smaValue) && smaValue > 0 && last !== undefined
      ? ((last - smaValue) / smaValue) * 100
      : null
  return {
    funding: market?.funding ?? null,
    open_interest: market?.openInterest ?? null,
    volume_24h: market?.dayNotionalVolume ?? null,
    rsi14: Number.isFinite(rsiValue) ? rsiValue : null,
    sma_distance_pct: smaDistance,
  }
}

function aggregateReadiness(views: WatchlistFrameworkView[]): number {
  if (views.length === 0) return 0
  let max = 0
  for (const v of views) {
    if (v.breakdown.totalCount === 0) continue
    const r = v.breakdown.metCount / v.breakdown.totalCount
    if (r > max) max = r
  }
  return max
}

export async function getWatchlistView(): Promise<WatchlistView> {
  const service = createServiceClient()
  const fetchedAt = new Date().toISOString()

  const [universeRes, thresholds, narrative, active] = await Promise.all([
    service
      .from('universe')
      .select('symbol, is_watchlist, is_active')
      .eq('is_active', true)
      .eq('is_watchlist', true)
      .order('symbol', { ascending: true }),
    loadThresholds(),
    loadNarrativeTags(),
    loadActiveStrategy(),
  ])

  const watchlistSymbols = (universeRes.data ?? []).map((r) => String(r.symbol))
  if (watchlistSymbols.length === 0) {
    return {
      pairs: [],
      watchlist_size: 0,
      watchlist_max: WATCHLIST_MAX,
      watchlist_min: WATCHLIST_MIN,
      active_strategy_id: active?.id ?? null,
      active_framework_id: active?.framework_id ?? null,
      fetched_at: fetchedAt,
    }
  }

  // Pull current market data for everything in one shot, then candles
  // per symbol. BTC is always fetched even if it isn't on the watchlist
  // because the narrative-breakout framework needs its 24h return.
  const candleSymbols = Array.from(new Set([...watchlistSymbols, 'BTC']))
  const [allMarket, oiHistory, candleResults] = await Promise.all([
    getAllMarketData().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[watchlist] market data failed: ${message}`)
      return new Map<string, MarketData>()
    }),
    loadOiHistory(watchlistSymbols),
    Promise.all(
      candleSymbols.map(async (sym) => {
        try {
          const candles = await getCandles(sym, '1h', CANDLE_LOOKBACK)
          return [sym, candles] as const
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[watchlist] candles for ${sym} failed: ${message}`)
          return [sym, [] as Candle[]] as const
        }
      }),
    ),
  ])

  const candleMap = new Map<string, Candle[]>(candleResults)
  const btcCandles = candleMap.get('BTC') ?? []
  const btcReturn24h = computeChange24h(btcCandles)

  const pairs: WatchlistPairView[] = []
  for (const symbol of watchlistSymbols) {
    const market = allMarket.get(symbol)
    const candles = candleMap.get(symbol) ?? []
    const hasData = Boolean(market) && candles.length > 0
    const change24h = computeChange24h(candles)
    const context = computeContext(market, candles)
    const spark = candles.slice(-20).map((c) => c.c)
    const heat = narrative.get(symbol) ?? null

    const frameworks: WatchlistFrameworkView[] = []
    if (hasData && market) {
      const snapshot: FrameworkMarketSnapshot = {
        symbol,
        markPrice: market.markPrice,
        funding: market.funding,
        openInterest: market.openInterest,
        dayNotionalVolume: market.dayNotionalVolume,
        candles,
        narrativeHeat: heat ?? undefined,
        oiHistory: oiHistory.get(symbol),
        btcReturn24h: btcReturn24h ?? undefined,
      }
      for (const fid of FRAMEWORK_ORDER) {
        const framework = FRAMEWORKS.get(fid)
        const fThresholds = thresholds.get(fid)
        if (!framework || !fThresholds) continue
        try {
          const result = framework.evaluate(snapshot, fThresholds)
          frameworks.push({
            id: framework.id,
            name: framework.name,
            breakdown: buildChipsFor(framework.id, result, fThresholds),
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(
            `[watchlist] framework ${framework.id} for ${symbol} failed: ${message}`,
          )
        }
      }
    }

    pairs.push({
      symbol,
      narrative_heat: heat,
      is_major: MAJOR_SET.has(symbol),
      price: market?.markPrice ?? null,
      change_24h_pct: change24h,
      has_data: hasData,
      context,
      spark,
      frameworks,
      overall_readiness: aggregateReadiness(frameworks),
      any_firing: frameworks.some((f) => f.breakdown.wouldTrigger),
    })
  }

  return {
    pairs,
    watchlist_size: pairs.length,
    watchlist_max: WATCHLIST_MAX,
    watchlist_min: WATCHLIST_MIN,
    active_strategy_id: active?.id ?? null,
    active_framework_id: active?.framework_id ?? null,
    fetched_at: fetchedAt,
  }
}

/**
 * Lightweight 30s ticker payload. Pulls the same source as the full
 * view but only returns the fields the price strip needs, so we don't
 * pay the candle and OI fetch on every refresh.
 */
export async function getWatchlistPrices(): Promise<WatchlistPrice[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('universe')
    .select('symbol')
    .eq('is_active', true)
    .eq('is_watchlist', true)
    .order('symbol', { ascending: true })
  if (error || !data || data.length === 0) return []
  const symbols = data.map((r) => String(r.symbol))

  let allMarket: Map<string, MarketData>
  try {
    allMarket = await getAllMarketData()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[watchlist ticker] market fetch failed: ${message}`)
    return []
  }

  // 24h change is best derived from candles, which we don't have here.
  // We use Hyperliquid's prevDayPx where available via a candle pull
  // for the symbol. To keep the ticker truly lightweight we send the
  // change as null and let the page keep its server-rendered value.
  return symbols.map((symbol) => {
    const m = allMarket.get(symbol)
    return {
      symbol,
      price: m?.markPrice ?? 0,
      change_24h_pct: null,
      volume_24h: m?.dayNotionalVolume ?? null,
    }
  })
}

export async function updateWatchlist(
  symbols: string[],
): Promise<UpdateWatchlistResult> {
  if (!(await requireUser())) {
    return { ok: false, message: 'Not authenticated' }
  }

  const cleaned = Array.from(
    new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)),
  )
  const parsed = updateWatchlistSchema.safeParse({ symbols: cleaned })
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, message: first?.message ?? 'Invalid watchlist' }
  }

  const service = createServiceClient()
  const { data: existingRows, error: existingErr } = await service
    .from('universe')
    .select('symbol')
    .eq('is_active', true)
  if (existingErr || !existingRows) {
    return {
      ok: false,
      message: existingErr?.message ?? 'Universe lookup failed',
    }
  }
  const known = new Set(existingRows.map((r) => String(r.symbol)))
  const unknown = parsed.data.symbols.filter((s) => !known.has(s))
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `Unknown pairs: ${unknown.slice(0, 3).join(', ')}`,
    }
  }

  const onList = new Set(parsed.data.symbols)
  const toEnable = parsed.data.symbols
  const toDisable = [...known].filter((s) => !onList.has(s))

  const enable = await service
    .from('universe')
    .update({ is_watchlist: true })
    .in('symbol', toEnable)
  if (enable.error) return { ok: false, message: enable.error.message }
  if (toDisable.length > 0) {
    const disable = await service
      .from('universe')
      .update({ is_watchlist: false })
      .in('symbol', toDisable)
    if (disable.error) return { ok: false, message: disable.error.message }
  }

  revalidatePath('/watchlist')
  return { ok: true, selected_count: parsed.data.symbols.length }
}
