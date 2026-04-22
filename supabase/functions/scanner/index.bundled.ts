// Bundled single-file Scanner for the Supabase dashboard editor.
//
// This file is a flattened copy of:
//   supabase/functions/scanner/index.ts
//   supabase/functions/_shared/hyperliquid.ts
//   supabase/functions/_shared/telegram.ts
//   supabase/functions/_shared/frameworks/types.ts
//   supabase/functions/_shared/frameworks/liquidation_hunt.ts
//   supabase/functions/_shared/frameworks/index.ts
//
// The split files are kept for readability in the repo. When you update
// any of them, re-flatten into this file before deploying through the
// dashboard. The behaviour and exports are identical.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1'

// ---------------------------------------------------------------------
// Hyperliquid client
// ---------------------------------------------------------------------

const INFO_URL = 'https://api.hyperliquid.xyz/info'
const HL_TIMEOUT_MS = 10_000

type MarketData = {
  symbol: string
  markPrice: number
  funding: number
  openInterest: number
  dayNotionalVolume: number
}

type Candle = {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

type AssetCtx = {
  funding: string
  openInterest: string
  prevDayPx: string
  dayNtlVlm: string
  markPx: string
  midPx?: string
  oraclePx?: string
}

type MetaAndAssetCtxsResponse = [
  { universe: Array<{ name: string; szDecimals: number }> },
  AssetCtx[],
]

type RawCandle = {
  t: number
  o: string | number
  h: string | number
  l: string | number
  c: string | number
  v: string | number
}

async function postInfo<T>(
  body: Record<string, unknown>,
  timeoutMs = HL_TIMEOUT_MS,
): Promise<T> {
  async function once(): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(INFO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`Hyperliquid ${res.status} ${res.statusText}`)
      }
      return (await res.json()) as T
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    return await once()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[hyperliquid] first attempt failed: ${message} (retrying)`)
    return await once()
  }
}

function toNumber(value: string | number | undefined): number {
  if (value === undefined || value === null) return 0
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

async function getAllMarketData(): Promise<Map<string, MarketData>> {
  const response = await postInfo<MetaAndAssetCtxsResponse>({
    type: 'metaAndAssetCtxs',
  })
  const [meta, ctxs] = response
  const out = new Map<string, MarketData>()
  for (let i = 0; i < meta.universe.length; i++) {
    const entry = meta.universe[i]
    const ctx = ctxs[i]
    if (!entry || !ctx) continue
    out.set(entry.name, {
      symbol: entry.name,
      markPrice: toNumber(ctx.markPx),
      funding: toNumber(ctx.funding),
      openInterest: toNumber(ctx.openInterest),
      dayNotionalVolume: toNumber(ctx.dayNtlVlm),
    })
  }
  return out
}

async function getCandles(
  symbol: string,
  interval: '1h' | '4h',
  lookback = 100,
): Promise<Candle[]> {
  const now = Date.now()
  const intervalMs = interval === '1h' ? 60 * 60 * 1000 : 4 * 60 * 60 * 1000
  const startTime = now - intervalMs * lookback
  const response = await postInfo<RawCandle[]>({
    type: 'candleSnapshot',
    req: {
      coin: symbol,
      interval,
      startTime,
      endTime: now,
    },
  })
  return response.map((c) => ({
    t: c.t,
    o: toNumber(c.o),
    h: toNumber(c.h),
    l: toNumber(c.l),
    c: toNumber(c.c),
    v: toNumber(c.v),
  }))
}

// ---------------------------------------------------------------------
// Telegram notifier
// ---------------------------------------------------------------------

type TelegramAlertPayload = {
  framework_name: string
  symbol: string
  direction: 'long' | 'short'
  entry: number
  stop: number
  target: number
  funding: number
  oiDeltaPct: number
  appUrl: string
}

function pct(x: number, digits = 2): string {
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`
}

function priceDiffPct(from: number, to: number): string {
  if (!Number.isFinite(from) || from === 0) return '-'
  return `${((Math.abs(to - from) / from) * 100).toFixed(2)}%`
}

function escapeMarkdown(value: string): string {
  return value.replace(/([_*`\[])/g, '\\$1')
}

function formatAlertMessage(alert: TelegramAlertPayload): string {
  const dirLabel = alert.direction.toUpperCase()
  const fundingLabel = pct(alert.funding, 3)
  const oiLabel = `${alert.oiDeltaPct >= 0 ? '+' : ''}${alert.oiDeltaPct.toFixed(0)}% vs 24h avg`
  return [
    `🚨 *${escapeMarkdown(alert.framework_name)}* — *${escapeMarkdown(alert.symbol)}*`,
    `Direction: *${dirLabel}*`,
    `Entry: ${alert.entry.toLocaleString(undefined, { maximumFractionDigits: 6 })}`,
    `Stop: ${alert.stop.toLocaleString(undefined, { maximumFractionDigits: 6 })} (${priceDiffPct(alert.entry, alert.stop)})`,
    `Target: ${alert.target.toLocaleString(undefined, { maximumFractionDigits: 6 })} (${priceDiffPct(alert.entry, alert.target)})`,
    `Funding: ${fundingLabel} | OI: ${oiLabel}`,
    '',
    `View in Dizzy Trade: ${alert.appUrl}`,
  ].join('\n')
}

async function sendTelegramAlert(
  alert: TelegramAlertPayload,
): Promise<boolean> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')
  if (!token || !chatId) {
    console.warn('[telegram] not configured, skipping notification')
    return false
  }

  const text = formatAlertMessage(alert)
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      },
    )
    if (!response.ok) {
      const body = await response.text()
      console.error(
        `[telegram] send failed ${response.status}: ${body.slice(0, 200)}`,
      )
      return false
    }
    return true
  } catch (error) {
    console.error('[telegram] send errored:', error)
    return false
  }
}

// ---------------------------------------------------------------------
// Framework interface
// ---------------------------------------------------------------------

type MarketSnapshot = {
  symbol: string
  markPrice: number
  funding: number
  openInterest: number
  dayNotionalVolume: number
  candles1h?: Candle[]
  candles4h?: Candle[]
  fundingHistory?: number[]
  oiHistory?: number[]
}

type FrameworkResult = {
  triggered: boolean
  conditionValues: Record<string, number | string | boolean>
  suggestedDirection?: 'long' | 'short'
  suggestedEntry?: number
  suggestedStop?: number
  suggestedTarget?: number
}

type DataRequirements = {
  needsCandles1h?: boolean
  needsCandles4h?: boolean
  needsFundingHistory?: boolean
  needsOiHistory?: boolean
}

type Framework = {
  id: string
  name: string
  description: string
  dataRequirements: DataRequirements
  evaluate(snapshot: MarketSnapshot): FrameworkResult
}

// ---------------------------------------------------------------------
// Liquidation hunt framework
// ---------------------------------------------------------------------

const FUNDING_THRESHOLD = 0.0001
const OI_MULTIPLIER = 1.3
const WICK_BODY_RATIO = 1.5
const STOP_BUFFER = 0.002
const TARGET_R_MULTIPLE = 2

const liquidationHuntFramework: Framework = {
  id: 'liquidation_hunt_v1',
  name: 'Liquidation hunt',
  description:
    'Extreme funding plus elevated open interest plus a rejected wick opposite to the funding bias.',
  dataRequirements: {
    needsCandles1h: true,
    needsFundingHistory: false,
    needsOiHistory: true,
  },
  evaluate(snapshot: MarketSnapshot): FrameworkResult {
    const conditionValues: Record<string, number | string | boolean> = {
      funding: snapshot.funding,
      openInterest: snapshot.openInterest,
    }

    const absFunding = Math.abs(snapshot.funding)
    conditionValues.absFunding = absFunding
    conditionValues.fundingThreshold = FUNDING_THRESHOLD
    if (absFunding <= FUNDING_THRESHOLD) {
      return { triggered: false, conditionValues }
    }

    const oiHistory = snapshot.oiHistory ?? []
    if (oiHistory.length === 0) {
      conditionValues.oiHistoryLength = 0
      return { triggered: false, conditionValues }
    }
    const oiAvg = oiHistory.reduce((acc, x) => acc + x, 0) / oiHistory.length
    const oiRatio = oiAvg > 0 ? snapshot.openInterest / oiAvg : 0
    const oiDeltaPct = oiAvg > 0 ? (snapshot.openInterest / oiAvg - 1) * 100 : 0
    conditionValues.oiAvg24h = oiAvg
    conditionValues.oiRatio = oiRatio
    conditionValues.oiDeltaPct = oiDeltaPct
    if (oiRatio < OI_MULTIPLIER) {
      return { triggered: false, conditionValues }
    }

    const candles = snapshot.candles1h ?? []
    if (candles.length === 0) {
      conditionValues.candleAvailable = false
      return { triggered: false, conditionValues }
    }
    const candle = candles[candles.length - 1]!
    const body = Math.abs(candle.c - candle.o)
    const upperWick = candle.h - Math.max(candle.o, candle.c)
    const lowerWick = Math.min(candle.o, candle.c) - candle.l
    conditionValues.candleOpen = candle.o
    conditionValues.candleHigh = candle.h
    conditionValues.candleLow = candle.l
    conditionValues.candleClose = candle.c
    conditionValues.body = body
    conditionValues.upperWick = upperWick
    conditionValues.lowerWick = lowerWick

    const effectiveBody = Math.max(body, Math.abs(candle.c) * 1e-6, 1e-9)

    let direction: 'long' | 'short'
    let stop: number
    let rejected: boolean

    if (snapshot.funding > 0) {
      direction = 'short'
      const wickRatio = upperWick / effectiveBody
      conditionValues.wickRatio = wickRatio
      if (wickRatio < WICK_BODY_RATIO) {
        return { triggered: false, conditionValues }
      }
      rejected = candle.c < candle.h
      conditionValues.closedInsideWick = rejected
      if (!rejected) {
        return { triggered: false, conditionValues }
      }
      stop = candle.h * (1 + STOP_BUFFER)
    } else {
      direction = 'long'
      const wickRatio = lowerWick / effectiveBody
      conditionValues.wickRatio = wickRatio
      if (wickRatio < WICK_BODY_RATIO) {
        return { triggered: false, conditionValues }
      }
      rejected = candle.c > candle.l
      conditionValues.closedInsideWick = rejected
      if (!rejected) {
        return { triggered: false, conditionValues }
      }
      stop = candle.l * (1 - STOP_BUFFER)
    }

    const entry = snapshot.markPrice
    const risk = Math.abs(entry - stop)
    const target =
      direction === 'short'
        ? entry - risk * TARGET_R_MULTIPLE
        : entry + risk * TARGET_R_MULTIPLE

    return {
      triggered: true,
      conditionValues,
      suggestedDirection: direction,
      suggestedEntry: entry,
      suggestedStop: stop,
      suggestedTarget: target,
    }
  },
}

const FRAMEWORKS: Map<string, Framework> = new Map([
  [liquidationHuntFramework.id, liquidationHuntFramework],
])

// ---------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------

const CONCURRENCY = 5
const HISTORY_WINDOW_MINUTES = 60 * 24
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
}

function aggregateRequirements(
  frameworks: Framework[],
): AggregatedRequirements {
  const out: AggregatedRequirements = {
    needsCandles1h: false,
    needsCandles4h: false,
    needsOiHistory: false,
    needsFundingHistory: false,
  }
  for (const f of frameworks) {
    const r: DataRequirements = f.dataRequirements
    if (r.needsCandles1h) out.needsCandles1h = true
    if (r.needsCandles4h) out.needsCandles4h = true
    if (r.needsOiHistory) out.needsOiHistory = true
    if (r.needsFundingHistory) out.needsFundingHistory = true
  }
  return out
}

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
}> {
  const started = Date.now()

  const universe = await loadUniverse()
  const symbols = universe.map((u) => u.symbol)
  const requirements = aggregateRequirements(Array.from(FRAMEWORKS.values()))

  const markets = await getAllMarketData()

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

  const history =
    requirements.needsOiHistory || requirements.needsFundingHistory
      ? await loadHistory(symbols)
      : new Map<string, { funding: number[]; oi: number[] }>()

  type EvalTask = UniverseRow & { market: MarketData }
  const tasks: EvalTask[] = universe.flatMap((u) => {
    const market = markets.get(u.symbol)
    return market ? [{ ...u, market }] : []
  })

  let triggered = 0

  await pMap(tasks, CONCURRENCY, async (task) => {
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
      }

      for (const framework of FRAMEWORKS.values()) {
        let result
        try {
          result = framework.evaluate(snapshot)
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
  }
}

Deno.serve(async () => {
  try {
    const summary = await runScan()
    console.log(
      `[scanner] scanned=${summary.scanned} triggered=${summary.triggered} durationMs=${summary.durationMs}`,
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
