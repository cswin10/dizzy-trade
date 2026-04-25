// Scanner Edge Function.
//
// Runs every minute via pg_cron. On each tick:
//   1. load the active universe and bulk-fetch market data
//   2. write one market_snapshots row per universe pair (rolling
//      history for OI and funding, used by frameworks that ask for it)
//   3. load active strategies plus the global config (thresholds,
//      narrative tags, BTC reference return)
//   4. for each strategy, evaluate its framework against each of its
//      configured pair_symbols on the strategy's chosen timeframe
//   5. insert alerts (tagged with strategy_id) and fire Telegram
//      notifications for watchlist symbols
//
// Errors on a single pair are logged and swallowed so the rest of the
// scan still runs. A soft 45s and hard 55s time budget caps the
// per-tick work so cron doesn't pile up if Hyperliquid is slow.
//
// market_snapshots writes cover the full universe even though only
// strategy pairs are evaluated. Future strategies that change their
// pair list need historical OI/funding to be useful from day one.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1'

import {
  getAllMarketData,
  getCandles,
  type Candle,
  type MarketData,
} from '../_shared/hyperliquid.ts'
import { sendTelegramAlert } from '../_shared/telegram.ts'
import { FRAMEWORKS } from '../_shared/frameworks/index.ts'
import type {
  MarketSnapshot,
  NarrativeHeat,
} from '../_shared/frameworks/types.ts'

const CONCURRENCY = 5
const HISTORY_WINDOW_MINUTES = 60 * 24 // 24 hours
const SOFT_BUDGET_MS = 45_000
const HARD_BUDGET_MS = 55_000
const CANDLE_LOOKBACK = 60
const APP_URL =
  Deno.env.get('DIZZY_TRADE_APP_URL') ?? 'https://dizzy-trade.vercel.app'

type Timeframe = '15m' | '1h' | '4h' | '1d'

type UniverseRow = {
  symbol: string
  coingecko_id: string | null
  is_watchlist: boolean
}

type StrategyRow = {
  id: string
  name: string
  framework_id: string
  timeframe: Timeframe
  pair_symbols: string[]
  is_active: boolean
}

// Simple concurrency pool: run `fn` over every item, but never more than
// `limit` in flight at once. Preserves result ordering by index.
async function pMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++
      try {
        results[idx] = await fn(items[idx]!, idx)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[scanner] task ${idx} failed: ${message}`)
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  )
  await Promise.all(workers)
  return results
}

function supabase() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function loadUniverse(): Promise<UniverseRow[]> {
  const client = supabase()
  const { data, error } = await client
    .from('universe')
    .select('symbol, coingecko_id, is_watchlist')
    .eq('is_active', true)
  if (error) throw new Error(`universe load failed: ${error.message}`)
  return (data ?? []) as UniverseRow[]
}

async function loadActiveStrategies(): Promise<StrategyRow[]> {
  const client = supabase()
  const { data, error } = await client
    .from('strategies')
    .select('id, name, framework_id, timeframe, pair_symbols, is_active')
    .eq('is_active', true)
  if (error) {
    throw new Error(`strategies load failed: ${error.message}`)
  }
  return (data ?? []) as StrategyRow[]
}

// Nested map: framework_id -> key -> value. Frameworks that have no
// row in the table get an empty inner map and will error on missing
// keys, which surfaces quickly in logs without silently misfiring.
async function loadThresholds(): Promise<Map<string, Record<string, number>>> {
  const client = supabase()
  const { data, error } = await client
    .from('framework_thresholds')
    .select('framework_id, key, value')
  if (error) {
    throw new Error(`threshold load failed: ${error.message}`)
  }
  const out = new Map<string, Record<string, number>>()
  for (const row of data ?? []) {
    const frameworkId = String(row.framework_id)
    const bucket = out.get(frameworkId) ?? {}
    bucket[String(row.key)] = Number(row.value)
    out.set(frameworkId, bucket)
  }
  return out
}

async function loadNarrativeHeat(): Promise<Map<string, NarrativeHeat>> {
  const client = supabase()
  const { data, error } = await client
    .from('narrative_tags')
    .select('symbol, heat_level')
  if (error) {
    console.warn(`[scanner] narrative load failed: ${error.message}`)
    return new Map()
  }
  const out = new Map<string, NarrativeHeat>()
  for (const row of data ?? []) {
    out.set(String(row.symbol), row.heat_level as NarrativeHeat)
  }
  return out
}

// 24h BTC return computed from 1h candles (24 bars back). Frameworks
// that need a BTC outperformance baseline read this off the snapshot.
// Returns 0 when the data isn't available so downstream conditions
// degrade gracefully rather than crashing the scan.
async function loadBtcReturn24h(): Promise<number> {
  try {
    const candles = await getCandles('BTC', '1h', 30)
    if (candles.length < 25) return 0
    const latest = candles[candles.length - 1]!.c
    const ref = candles[candles.length - 25]!.c
    if (ref <= 0) return 0
    return (latest - ref) / ref
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[scanner] BTC baseline failed: ${message}`)
    return 0
  }
}

type SnapshotInsert = {
  symbol: string
  mark_price: number | null
  funding: number | null
  open_interest: number | null
  day_notional_volume: number | null
}

async function writeSnapshots(rows: SnapshotInsert[]): Promise<void> {
  if (rows.length === 0) return
  const client = supabase()
  const { error } = await client.from('market_snapshots').insert(rows)
  if (error) {
    console.error(`[scanner] snapshot insert failed: ${error.message}`)
  }
}

async function loadHistory(
  symbols: string[],
): Promise<Map<string, { funding: number[]; oi: number[] }>> {
  const result = new Map<string, { funding: number[]; oi: number[] }>()
  if (symbols.length === 0) return result
  const client = supabase()
  const since = new Date(
    Date.now() - HISTORY_WINDOW_MINUTES * 60 * 1000,
  ).toISOString()
  const { data, error } = await client
    .from('market_snapshots')
    .select('symbol, funding, open_interest, captured_at')
    .in('symbol', symbols)
    .gte('captured_at', since)
    .order('captured_at', { ascending: true })
  if (error) {
    console.error(`[scanner] history load failed: ${error.message}`)
    return result
  }
  for (const row of data ?? []) {
    const bucket = result.get(row.symbol) ?? { funding: [], oi: [] }
    if (row.funding !== null) bucket.funding.push(Number(row.funding))
    if (row.open_interest !== null) {
      bucket.oi.push(Number(row.open_interest))
    }
    result.set(row.symbol, bucket)
  }
  return result
}

type AlertInsert = {
  strategy_id: string
  framework_id: string
  symbol: string
  coingecko_id: string | null
  condition_values: Record<string, unknown>
  suggested_direction: 'long' | 'short' | null
  suggested_entry: number | null
  suggested_stop: number | null
  suggested_target: number | null
  is_watchlist: boolean
  notified_telegram: boolean
}

async function insertAlert(alert: AlertInsert): Promise<string | null> {
  const client = supabase()
  const { data, error } = await client
    .from('alerts')
    .insert(alert)
    .select('id')
    .single()
  if (error) {
    console.error(`[scanner] alert insert failed: ${error.message}`)
    return null
  }
  return (data?.id as string) ?? null
}

async function markNotified(alertId: string): Promise<void> {
  const client = supabase()
  await client
    .from('alerts')
    .update({ notified_telegram: true })
    .eq('id', alertId)
}

type StrategySummary = {
  name: string
  scanned: number
  triggered: number
}

async function evaluateStrategy(args: {
  strategy: StrategyRow
  markets: Map<string, MarketData>
  universeBySymbol: Map<string, UniverseRow>
  thresholds: Map<string, Record<string, number>>
  history: Map<string, { funding: number[]; oi: number[] }>
  narrativeHeat: Map<string, NarrativeHeat>
  btcReturn24h: number
  scanStartedAt: number
  budgetState: { softLogged: boolean; truncated: boolean }
}): Promise<StrategySummary> {
  const {
    strategy,
    markets,
    universeBySymbol,
    thresholds,
    history,
    narrativeHeat,
    btcReturn24h,
    scanStartedAt,
    budgetState,
  } = args

  const summary: StrategySummary = {
    name: strategy.name,
    scanned: 0,
    triggered: 0,
  }

  const framework = FRAMEWORKS.get(strategy.framework_id)
  if (!framework) {
    console.warn(
      `[scanner] strategy=${strategy.name} references unknown framework_id=${strategy.framework_id}, skipping`,
    )
    return summary
  }

  const frameworkThresholds = thresholds.get(strategy.framework_id) ?? {}

  await pMap(strategy.pair_symbols, CONCURRENCY, async (symbol) => {
    const elapsed = Date.now() - scanStartedAt
    if (elapsed > HARD_BUDGET_MS) {
      budgetState.truncated = true
      return
    }
    if (elapsed > SOFT_BUDGET_MS && !budgetState.softLogged) {
      console.warn(
        `[scanner] soft time budget exceeded at ${elapsed}ms, continuing`,
      )
      budgetState.softLogged = true
    }

    const meta = markets.get(symbol)
    if (!meta) return
    summary.scanned++

    let candles: Candle[] = []
    try {
      candles = await getCandles(symbol, strategy.timeframe, CANDLE_LOOKBACK)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[scanner] ${symbol} candle fetch failed: ${message}`)
      return
    }

    const bucket = history.get(symbol)
    const universeRow = universeBySymbol.get(symbol)
    const snapshot: MarketSnapshot = {
      symbol,
      markPrice: meta.markPrice,
      funding: meta.funding,
      openInterest: meta.openInterest,
      dayNotionalVolume: meta.dayNotionalVolume,
      candles,
      fundingHistory: bucket?.funding ?? [],
      oiHistory: bucket?.oi ?? [],
      narrativeHeat: narrativeHeat.get(symbol) ?? 'cool',
      btcReturn24h,
    }

    let result
    try {
      result = framework.evaluate(snapshot, frameworkThresholds)
    } catch (error) {
      console.error(
        `[scanner] strategy=${strategy.name} framework=${framework.id} threw for ${symbol}:`,
        error,
      )
      return
    }
    if (!result.triggered) return

    summary.triggered++
    const isWatchlist = universeRow?.is_watchlist ?? true
    const alertId = await insertAlert({
      strategy_id: strategy.id,
      framework_id: framework.id,
      symbol,
      coingecko_id: universeRow?.coingecko_id ?? null,
      condition_values: result.conditionValues,
      suggested_direction: result.suggestedDirection ?? null,
      suggested_entry: result.suggestedEntry ?? null,
      suggested_stop: result.suggestedStop ?? null,
      suggested_target: result.suggestedTarget ?? null,
      is_watchlist: isWatchlist,
      notified_telegram: false,
    })
    if (!alertId) return

    if (
      isWatchlist &&
      result.suggestedDirection &&
      result.suggestedEntry != null &&
      result.suggestedStop != null &&
      result.suggestedTarget != null
    ) {
      const oiDeltaPct = Number(
        (result.conditionValues.oiDeltaPct as number | undefined) ?? 0,
      )
      const ok = await sendTelegramAlert({
        framework_name: framework.name,
        symbol,
        direction: result.suggestedDirection,
        entry: result.suggestedEntry,
        stop: result.suggestedStop,
        target: result.suggestedTarget,
        funding: meta.funding,
        oiDeltaPct,
        appUrl: `${APP_URL}/alerts`,
      })
      if (ok) await markNotified(alertId)
    }
  })

  return summary
}

async function runScan(): Promise<{
  scanned: number
  triggered: number
  durationMs: number
  truncated: boolean
  strategies: StrategySummary[]
}> {
  const started = Date.now()

  const universe = await loadUniverse()
  const universeBySymbol = new Map(universe.map((u) => [u.symbol, u]))

  // Bulk market data: single request covers every Hyperliquid perp.
  const markets: Map<string, MarketData> = await getAllMarketData()

  // market_snapshots covers the full universe so future strategies
  // have rolling OI/funding history available from day one.
  const snapshots: SnapshotInsert[] = []
  for (const row of universe) {
    const m = markets.get(row.symbol)
    if (!m) continue
    snapshots.push({
      symbol: row.symbol,
      mark_price: m.markPrice,
      funding: m.funding,
      open_interest: m.openInterest,
      day_notional_volume: m.dayNotionalVolume,
    })
  }
  await writeSnapshots(snapshots)

  const strategies = await loadActiveStrategies()
  if (strategies.length === 0) {
    console.warn('[scanner] no active strategies, nothing to evaluate')
    return {
      scanned: 0,
      triggered: 0,
      durationMs: Date.now() - started,
      truncated: false,
      strategies: [],
    }
  }

  // Union of pair symbols across all active strategies. History and
  // narrative heat get loaded once for this set rather than per
  // strategy.
  const strategyPairs = new Set<string>()
  for (const s of strategies) {
    for (const sym of s.pair_symbols) strategyPairs.add(sym)
  }

  const [thresholds, narrativeHeat, btcReturn24h, history] = await Promise.all([
    loadThresholds(),
    loadNarrativeHeat(),
    loadBtcReturn24h(),
    loadHistory([...strategyPairs]),
  ])

  const budgetState = { softLogged: false, truncated: false }
  const summaries: StrategySummary[] = []
  let totalScanned = 0
  let totalTriggered = 0

  for (const strategy of strategies) {
    const summary = await evaluateStrategy({
      strategy,
      markets,
      universeBySymbol,
      thresholds,
      history,
      narrativeHeat,
      btcReturn24h,
      scanStartedAt: started,
      budgetState,
    })
    summaries.push(summary)
    totalScanned += summary.scanned
    totalTriggered += summary.triggered
    console.log(
      `[scanner] strategy=${summary.name} scanned=${summary.scanned} triggered=${summary.triggered}`,
    )
    if (budgetState.truncated) break
  }

  return {
    scanned: totalScanned,
    triggered: totalTriggered,
    durationMs: Date.now() - started,
    truncated: budgetState.truncated,
    strategies: summaries,
  }
}

Deno.serve(async () => {
  try {
    const summary = await runScan()
    console.log(
      `[scanner] total scanned=${summary.scanned} triggered=${summary.triggered} durationMs=${summary.durationMs}${summary.truncated ? ' truncated=1' : ''}`,
    )
    return new Response(JSON.stringify({ ok: true, ...summary }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[scanner] fatal: ${message}`)
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
