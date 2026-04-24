// Scanner Edge Function.
//
// Runs every minute via pg_cron. On each tick:
//   1. load the active universe
//   2. bulk-fetch current market data from Hyperliquid
//   3. write one market_snapshots row per pair (rolling history)
//   4. load framework thresholds and narrative tags from the database
//   5. fetch BTC 4h candles once for the outperformance baseline
//   6. fetch any additional per-pair data the frameworks need, with
//      bounded concurrency so we don't blow rate limits
//   7. evaluate every framework against every pair using per-framework
//      thresholds; emit alerts for triggers
//
// Errors on a single pair are logged and swallowed so the rest of the
// scan still runs. A soft 45s and hard 55s time budget caps the per-tick
// work so cron doesn't pile up if Hyperliquid is slow.

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
  DataRequirements,
  Framework,
  MarketSnapshot,
  NarrativeHeat,
} from '../_shared/frameworks/types.ts'

const CONCURRENCY = 5
const HISTORY_WINDOW_MINUTES = 60 * 24 // 24 hours
const SOFT_BUDGET_MS = 45_000
const HARD_BUDGET_MS = 55_000
const APP_URL =
  Deno.env.get('DIZZY_TRADE_APP_URL') ?? 'https://dizzy-trade.vercel.app'

type UniverseRow = {
  symbol: string
  coingecko_id: string | null
  is_watchlist: boolean
}

type AggregatedRequirements = {
  needsCandles1h: boolean
  needsCandles4h: boolean
  needsOiHistory: boolean
  needsFundingHistory: boolean
  needsNarrativeHeat: boolean
  needsBtcReturn24h: boolean
}

function aggregateRequirements(
  frameworks: Framework[],
): AggregatedRequirements {
  const out: AggregatedRequirements = {
    needsCandles1h: false,
    needsCandles4h: false,
    needsOiHistory: false,
    needsFundingHistory: false,
    needsNarrativeHeat: false,
    needsBtcReturn24h: false,
  }
  for (const f of frameworks) {
    const r: DataRequirements = f.dataRequirements
    if (r.needsCandles1h) out.needsCandles1h = true
    if (r.needsCandles4h) out.needsCandles4h = true
    if (r.needsOiHistory) out.needsOiHistory = true
    if (r.needsFundingHistory) out.needsFundingHistory = true
    if (r.needsNarrativeHeat) out.needsNarrativeHeat = true
    if (r.needsBtcReturn24h) out.needsBtcReturn24h = true
  }
  return out
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

// Nested map: framework_id -> key -> value. Frameworks that have no row
// in the table get an empty inner map and will error on missing keys,
// which surfaces quickly in logs without silently misfiring.
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

// Price return over the last 24h using 4h candles. 6 bars back gives
// the close 24h ago. Returns 0 if the data isn't there so downstream
// conditions degrade gracefully rather than triggering.
async function loadBtcReturn24h(): Promise<number> {
  try {
    const candles = await getCandles('BTC', '4h', 10)
    if (candles.length < 7) return 0
    const latest = candles[candles.length - 1]!.c
    const ref = candles[candles.length - 7]!.c
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

async function runScan(): Promise<{
  scanned: number
  triggered: number
  durationMs: number
  truncated: boolean
}> {
  const started = Date.now()

  const universe = await loadUniverse()
  const symbols = universe.map((u) => u.symbol)
  const requirements = aggregateRequirements(Array.from(FRAMEWORKS.values()))

  // Bulk market data: single request covers every Hyperliquid perp.
  const markets: Map<string, MarketData> = await getAllMarketData()

  // Write snapshots up-front so subsequent frameworks benefit from the
  // fresh observation in later ticks.
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

  // Config and baselines. Thresholds fail the whole scan if missing
  // (frameworks cannot run without their tuning); narrative and BTC
  // baseline degrade to empty/zero so the rest of the scan still works.
  const [thresholds, narrativeHeatMap, btcReturn24h] = await Promise.all([
    loadThresholds(),
    requirements.needsNarrativeHeat
      ? loadNarrativeHeat()
      : Promise.resolve(new Map<string, NarrativeHeat>()),
    requirements.needsBtcReturn24h ? loadBtcReturn24h() : Promise.resolve(0),
  ])

  // Rolling history load (one round-trip for all symbols).
  const history =
    requirements.needsOiHistory || requirements.needsFundingHistory
      ? await loadHistory(symbols)
      : new Map<string, { funding: number[]; oi: number[] }>()

  // Per-pair work: fetch any candles frameworks need, evaluate each
  // framework, and emit alerts. Wrapped in a try/catch per pair so one
  // bad row doesn't kill the whole scan.
  type EvalTask = UniverseRow & { market: MarketData }
  const tasks: EvalTask[] = universe.flatMap((u) => {
    const market = markets.get(u.symbol)
    return market ? [{ ...u, market }] : []
  })

  let triggered = 0
  let truncated = false
  let softBudgetLogged = false

  await pMap(tasks, CONCURRENCY, async (task) => {
    const elapsed = Date.now() - started
    if (elapsed > HARD_BUDGET_MS) {
      truncated = true
      return
    }
    if (elapsed > SOFT_BUDGET_MS && !softBudgetLogged) {
      console.warn(
        `[scanner] soft time budget exceeded at ${elapsed}ms, continuing`,
      )
      softBudgetLogged = true
    }
    try {
      let candles1h: Candle[] | undefined
      let candles4h: Candle[] | undefined
      if (requirements.needsCandles1h) {
        candles1h = await getCandles(task.symbol, '1h', 100)
      }
      if (requirements.needsCandles4h) {
        candles4h = await getCandles(task.symbol, '4h', 100)
      }
      const bucket = history.get(task.symbol)
      const heat = narrativeHeatMap.get(task.symbol) ?? 'cool'
      const snapshot: MarketSnapshot = {
        symbol: task.symbol,
        markPrice: task.market.markPrice,
        funding: task.market.funding,
        openInterest: task.market.openInterest,
        dayNotionalVolume: task.market.dayNotionalVolume,
        candles1h,
        candles4h,
        fundingHistory: bucket?.funding ?? [],
        oiHistory: bucket?.oi ?? [],
        narrativeHeat: heat,
        btcReturn24h,
      }

      for (const framework of FRAMEWORKS.values()) {
        const frameworkThresholds = thresholds.get(framework.id) ?? {}
        let result
        try {
          result = framework.evaluate(snapshot, frameworkThresholds)
        } catch (error) {
          console.error(
            `[scanner] ${framework.id} threw for ${task.symbol}:`,
            error,
          )
          continue
        }
        if (!result.triggered) continue

        triggered++
        const alertId = await insertAlert({
          framework_id: framework.id,
          symbol: task.symbol,
          coingecko_id: task.coingecko_id,
          condition_values: result.conditionValues,
          suggested_direction: result.suggestedDirection ?? null,
          suggested_entry: result.suggestedEntry ?? null,
          suggested_stop: result.suggestedStop ?? null,
          suggested_target: result.suggestedTarget ?? null,
          is_watchlist: task.is_watchlist,
          notified_telegram: false,
        })
        if (!alertId) continue

        if (
          task.is_watchlist &&
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
            symbol: task.symbol,
            direction: result.suggestedDirection,
            entry: result.suggestedEntry,
            stop: result.suggestedStop,
            target: result.suggestedTarget,
            funding: task.market.funding,
            oiDeltaPct,
            appUrl: `${APP_URL}/alerts`,
          })
          if (ok) await markNotified(alertId)
        }
      }
    } catch (error) {
      console.error(`[scanner] pair ${task.symbol} failed:`, error)
    }
  })

  return {
    scanned: tasks.length,
    triggered,
    durationMs: Date.now() - started,
    truncated,
  }
}

Deno.serve(async () => {
  try {
    const summary = await runScan()
    console.log(
      `[scanner] scanned=${summary.scanned} triggered=${summary.triggered} durationMs=${summary.durationMs}${summary.truncated ? ' truncated=1' : ''}`,
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
