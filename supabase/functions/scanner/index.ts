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
import { sendTelegramAlert, sendTelegramClose } from '../_shared/telegram.ts'
import { FRAMEWORKS } from '../_shared/frameworks/index.ts'
import type {
  MarketSnapshot,
  NarrativeHeat,
} from '../_shared/frameworks/types.ts'
import { getGbpUsdRate } from '../_shared/fx.ts'
import {
  getUserFills,
  getUserState,
  type HyperliquidPosition,
} from '../_shared/hyperliquid_user.ts'
import { computeSizing } from '../_shared/position_sizing.ts'
import {
  evaluateRules,
  type RuleViolation,
  type RulesContext,
  type RulesStatus,
} from '../_shared/rules.ts'
import { nextCandleClose } from '../_shared/timeframes.ts'
import {
  loadActiveStrategy,
  type ActiveStrategy,
} from '../_shared/active-strategy.ts'
import '../_shared/strategies/register.ts'
import { evaluateStrategy as evaluateComposableDefinition } from '../_shared/strategies/evaluator.ts'
import type {
  EvaluationContext,
  StrategyDefinition,
} from '../_shared/strategies/types.ts'

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

type HyperliquidConfigRow = {
  tenant_id: string
  main_address: string
}

type LiveTradeRow = {
  id: string
  tenant_id: string
  asset_symbol: string
  direction: 'long' | 'short'
  entry_price: number
  linked_at: string | null
}

type StrategyRow = {
  id: string
  name: string
  framework_id: string
  timeframe: Timeframe
  pair_symbols: string[]
  risk_amount_gbp: number
  min_rr: number
  max_concurrent_positions: number
  max_daily_loss_gbp: number | null
  max_consecutive_losers: number | null
  deployment_status: 'draft' | 'live' | 'paused' | 'archived'
}

type RulesState = {
  open_positions_count: number
  today_realised_pnl_gbp: number
  consecutive_losers_count: number
  last_loss_at: Date | null
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
    .eq('deployment_status', 'live')
  if (error) throw new Error(`universe load failed: ${error.message}`)
  return (data ?? []) as UniverseRow[]
}

async function loadActiveStrategies(): Promise<StrategyRow[]> {
  const client = supabase()
  const { data, error } = await client
    .from('strategies')
    .select(
      'id, name, framework_id, timeframe, pair_symbols, risk_amount_gbp, min_rr, max_concurrent_positions, max_daily_loss_gbp, max_consecutive_losers, deployment_status',
    )
    .eq('deployment_status', 'live')
  if (error) {
    throw new Error(`strategies load failed: ${error.message}`)
  }
  return (data ?? []) as StrategyRow[]
}

// At scan time the scanner has no per-tenant context; for v1 with a
// single trader we aggregate across all trades. When we go multi-user
// this needs to scope by tenant.
async function loadRulesState(): Promise<RulesState> {
  const client = supabase()
  const todayUtcStart = new Date()
  todayUtcStart.setUTCHours(0, 0, 0, 0)

  const [openRes, pnlRes, lastLossRes, recentLossesRes] = await Promise.all([
    client
      .from('trades')
      .select('id', { count: 'exact', head: true })
      .eq('outcome', 'open'),
    client
      .from('trades')
      .select('pnl')
      .in('outcome', ['win', 'loss', 'breakeven'])
      .gte('exit_at', todayUtcStart.toISOString()),
    client
      .from('trades')
      .select('exit_at')
      .eq('outcome', 'loss')
      .order('exit_at', { ascending: false })
      .limit(1),
    client
      .from('trades')
      .select('outcome, exit_at')
      .in('outcome', ['win', 'loss', 'breakeven'])
      .order('exit_at', { ascending: false })
      .limit(20),
  ])

  const open_positions_count = openRes.count ?? 0

  let today_realised_pnl_gbp = 0
  for (const row of pnlRes.data ?? []) {
    const pnl = row.pnl
    if (typeof pnl === 'number' && Number.isFinite(pnl)) {
      today_realised_pnl_gbp += pnl
    }
  }

  let consecutive_losers_count = 0
  for (const row of recentLossesRes.data ?? []) {
    if (row.outcome === 'loss') consecutive_losers_count++
    else break
  }

  let last_loss_at: Date | null = null
  const lastLoss = lastLossRes.data?.[0]?.exit_at
  if (typeof lastLoss === 'string') last_loss_at = new Date(lastLoss)

  return {
    open_positions_count,
    today_realised_pnl_gbp,
    consecutive_losers_count,
    last_loss_at,
  }
}

function computeRrRatio(
  direction: 'long' | 'short' | undefined,
  entry: number | null | undefined,
  stop: number | null | undefined,
  target: number | null | undefined,
): number | null {
  if (entry == null || stop == null || target == null) return null
  if (!direction) return null
  const risk = direction === 'long' ? entry - stop : stop - entry
  const reward = direction === 'long' ? target - entry : entry - target
  if (risk <= 0 || reward <= 0) return null
  return reward / risk
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
  position_size_coin: number | null
  position_size_usd: number | null
  leverage_implied: number | null
  valid_until: string | null
  risk_amount_gbp: number | null
  gbp_usd_rate: number | null
  rules_status: RulesStatus | null
  rules_violations: RuleViolation[] | null
  alert_source?: 'framework' | 'composable'
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
  gbpUsdRate: number
  rulesState: RulesState
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
    gbpUsdRate,
    rulesState,
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

    // Position sizing is only meaningful when we have entry and stop;
    // narrative-only alerts without a stop fall back to nulls so the
    // schema stays uniform.
    let sizing: ReturnType<typeof computeSizing> | null = null
    if (
      result.suggestedEntry != null &&
      result.suggestedStop != null &&
      strategy.risk_amount_gbp > 0
    ) {
      sizing = computeSizing({
        entry: result.suggestedEntry,
        stop: result.suggestedStop,
        riskGbp: strategy.risk_amount_gbp,
        gbpUsdRate,
      })
    }
    const validUntil = nextCandleClose(strategy.timeframe)

    const rrRatio = computeRrRatio(
      result.suggestedDirection,
      result.suggestedEntry,
      result.suggestedStop,
      result.suggestedTarget,
    )
    const rulesContext: RulesContext = {
      strategy: {
        risk_amount_gbp: strategy.risk_amount_gbp,
        min_rr: strategy.min_rr,
        max_concurrent_positions: strategy.max_concurrent_positions,
        max_daily_loss_gbp: strategy.max_daily_loss_gbp,
        max_consecutive_losers: strategy.max_consecutive_losers,
      },
      proposedTrade: {
        risk_amount_gbp: strategy.risk_amount_gbp,
        rr_ratio: rrRatio,
      },
      currentState: rulesState,
    }
    const rulesResult = evaluateRules(rulesContext)

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
      position_size_coin: sizing?.positionSizeCoin ?? null,
      position_size_usd: sizing?.positionSizeUsd ?? null,
      leverage_implied: sizing?.leverageImplied ?? null,
      valid_until: validUntil.toISOString(),
      risk_amount_gbp: strategy.risk_amount_gbp,
      gbp_usd_rate: gbpUsdRate,
      rules_status: rulesResult.status,
      rules_violations: rulesResult.violations,
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
        positionSizeCoin: sizing?.positionSizeCoin ?? null,
        positionSizeUsd: sizing?.positionSizeUsd ?? null,
        leverageImplied: sizing?.leverageImplied ?? null,
        riskAmountGbp: strategy.risk_amount_gbp,
        validUntil,
        timeframe: strategy.timeframe,
        rulesStatus: rulesResult.status,
        rulesViolations: rulesResult.violations,
      })
      if (ok) await markNotified(alertId)
    }
  })

  return summary
}

// Mirror of evaluateStrategy for composable strategy_definitions.
// The shape of work (per-pair candle fetch, evaluator call,
// position sizing, rules evaluation, alert insert, Telegram fan-
// out) is the same, so the helpers above (computeSizing,
// computeRrRatio, evaluateRules, insertAlert, sendTelegramAlert)
// stay shared. The differences are bundled here so the legacy
// path stays untouched.
async function evaluateComposableStrategy(args: {
  strategy: ActiveStrategy
  markets: Map<string, MarketData>
  universeBySymbol: Map<string, UniverseRow>
  gbpUsdRate: number
  rulesState: RulesState
  scanStartedAt: number
  budgetState: { softLogged: boolean; truncated: boolean }
}): Promise<StrategySummary> {
  const {
    strategy,
    markets,
    universeBySymbol,
    gbpUsdRate,
    rulesState,
    scanStartedAt,
    budgetState,
  } = args
  const summary: StrategySummary = {
    name: strategy.name,
    scanned: 0,
    triggered: 0,
  }
  const definition = strategy.definition
  if (!definition) {
    console.warn(
      `[scanner] composable strategy=${strategy.name} has no definition snapshot, skipping`,
    )
    return summary
  }
  // Composable strategies do not yet expose a top-level
  // risk_amount_gbp; pull it from the sizing rule when it is
  // GBP-risk-based, otherwise leave null and rules-engine inputs
  // fall back to estimates.
  const sizingRule = definition.sizing
  const strategyRiskGbp =
    sizingRule.type === 'fixed_gbp_risk' ? sizingRule.amount : null

  await pMap(strategy.pairs, CONCURRENCY, async (symbol) => {
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
      candles = await getCandles(
        symbol,
        strategy.timeframe as Timeframe,
        CANDLE_LOOKBACK,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[scanner] ${symbol} candle fetch failed: ${message}`)
      return
    }
    if (candles.length === 0) return

    const universeRow = universeBySymbol.get(symbol)
    const last = candles[candles.length - 1]!

    const evalContext: EvaluationContext = {
      candles,
      currentCandle: last,
      currentPrice: last.c,
      // Live scanner has funding from market context; expose it so
      // the funding_threshold condition can fire instead of always
      // returning missing_data.
      funding: meta.funding,
      openInterest: meta.openInterest,
    }

    let result
    try {
      result = evaluateComposableDefinition(definition, evalContext)
    } catch (error) {
      console.error(
        `[scanner] composable strategy=${strategy.name} threw for ${symbol}:`,
        error,
      )
      return
    }
    if (!result.triggered) return
    summary.triggered++
    const isWatchlist = universeRow?.is_watchlist ?? true

    // Position sizing: if the definition specifies a coin-
    // denominated size, honour it. Otherwise fall back to the
    // GBP-risk path the legacy scanner uses.
    let sizing: ReturnType<typeof computeSizing> | null = null
    if (
      result.entry_price != null &&
      result.stop_price != null &&
      sizingRule.type === 'fixed_gbp_risk' &&
      sizingRule.amount > 0
    ) {
      sizing = computeSizing({
        entry: result.entry_price,
        stop: result.stop_price,
        riskGbp: sizingRule.amount,
        gbpUsdRate,
      })
    } else if (
      result.entry_price != null &&
      sizingRule.type === 'fixed_position_size'
    ) {
      const sizeUsd = sizingRule.size * result.entry_price
      sizing = {
        positionSizeCoin: sizingRule.size,
        positionSizeUsd: sizeUsd,
        leverageImplied: null,
      }
    }
    const validUntil = nextCandleClose(strategy.timeframe as Timeframe)

    const rrRatio = computeRrRatio(
      result.direction ?? null,
      result.entry_price ?? null,
      result.stop_price ?? null,
      result.target_price ?? null,
    )

    // For composable strategies with non-GBP sizing the daily-loss
    // rule needs an estimate of risk per trade. Use an approximate
    // 5% of position notional as a stop-distance proxy. This is
    // documented as approximate; the rules engine treats daily
    // loss as advisory anyway.
    const projectedRiskGbp =
      strategyRiskGbp ??
      (sizing && sizing.positionSizeUsd != null
        ? (sizing.positionSizeUsd * 0.05) / Math.max(gbpUsdRate, 1e-9)
        : null)

    const rulesContext: RulesContext = {
      strategy: {
        risk_amount_gbp: projectedRiskGbp ?? 0,
        min_rr: 0, // composable strategies do not impose a global min_rr
        max_concurrent_positions: strategy.max_concurrent_positions,
        max_daily_loss_gbp: strategy.max_daily_loss_gbp,
        max_consecutive_losers: strategy.max_consecutive_losers,
      },
      proposedTrade: {
        risk_amount_gbp: projectedRiskGbp,
        rr_ratio: rrRatio,
      },
      currentState: rulesState,
    }
    const rulesResult = evaluateRules(rulesContext)

    // Build a per-condition snapshot map alongside the engine's
    // flat condition_values so the alerts UI can render
    // group / index / pass per condition.
    const composableConditionValues: Record<string, unknown> = {
      source: 'composable',
      group_index: result.triggered_group_index ?? null,
      group_direction: result.direction ?? null,
      values: result.condition_values,
    }

    const alertId = await insertAlert({
      strategy_id: strategy.id,
      framework_id: 'composable',
      symbol,
      coingecko_id: universeRow?.coingecko_id ?? null,
      condition_values: composableConditionValues,
      suggested_direction: result.direction ?? null,
      suggested_entry: result.entry_price ?? null,
      suggested_stop: result.stop_price ?? null,
      suggested_target: result.target_price ?? null,
      is_watchlist: isWatchlist,
      notified_telegram: false,
      position_size_coin: sizing?.positionSizeCoin ?? null,
      position_size_usd: sizing?.positionSizeUsd ?? null,
      leverage_implied: sizing?.leverageImplied ?? null,
      valid_until: validUntil.toISOString(),
      risk_amount_gbp: projectedRiskGbp,
      gbp_usd_rate: gbpUsdRate,
      rules_status: rulesResult.status,
      rules_violations: rulesResult.violations,
      alert_source: 'composable',
    })
    if (!alertId) return

    if (
      isWatchlist &&
      result.direction &&
      result.entry_price != null &&
      result.stop_price != null &&
      result.target_price != null
    ) {
      const ok = await sendTelegramAlert({
        framework_name: strategy.name,
        symbol,
        direction: result.direction,
        entry: result.entry_price,
        stop: result.stop_price,
        target: result.target_price,
        funding: meta.funding,
        oiDeltaPct: 0,
        appUrl: `${APP_URL}/alerts`,
        positionSizeCoin: sizing?.positionSizeCoin ?? null,
        positionSizeUsd: sizing?.positionSizeUsd ?? null,
        leverageImplied: sizing?.leverageImplied ?? null,
        riskAmountGbp: projectedRiskGbp ?? 0,
        validUntil,
        timeframe: strategy.timeframe as Timeframe,
        rulesStatus: rulesResult.status,
        rulesViolations: rulesResult.violations,
      })
      if (ok) await markNotified(alertId)
    }
  })

  // Compact log: signal counts by condition pass instead of full
  // condition_values map.
  console.log(
    `[scanner] composable strategy=${strategy.name} pairs=${strategy.pairs.length} scanned=${summary.scanned} triggered=${summary.triggered}`,
  )
  return summary
}

async function runScan(): Promise<{
  scanned: number
  triggered: number
  durationMs: number
  truncated: boolean
  strategies: StrategySummary[]
  positionsTracked: number
  positionsClosed: number
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

  // Resolve the single active strategy. Prefers the composable
  // table when both have an active row (and logs the conflict).
  // Falls back to the legacy multi-strategy loader if the unified
  // resolver returns null AND a legacy row is somehow active
  // outside the index, so the v1 scanner stays compatible during
  // the transition.
  const activeStrategy: ActiveStrategy | null =
    await loadActiveStrategy(supabase())
  const strategies =
    activeStrategy && activeStrategy.source === 'framework'
      ? // Framework path: use the legacy loader to surface every
        // active framework row at once. The unified resolver hands
        // back exactly one but the legacy loader also supports the
        // (unsupported in v1) multi-active scenario, so we keep it
        // for parity.
        await loadActiveStrategies()
      : []
  if (
    strategies.length === 0 &&
    (!activeStrategy || activeStrategy.source !== 'composable')
  ) {
    console.warn('[scanner] no active strategies, nothing to evaluate')
    return {
      scanned: 0,
      triggered: 0,
      durationMs: Date.now() - started,
      truncated: false,
      strategies: [],
      positionsTracked: 0,
      positionsClosed: 0,
    }
  }

  // Union of pair symbols across the active source.
  const strategyPairs = new Set<string>()
  for (const s of strategies) {
    for (const sym of s.pair_symbols) strategyPairs.add(sym)
  }
  if (activeStrategy && activeStrategy.source === 'composable') {
    for (const sym of activeStrategy.pairs) strategyPairs.add(sym)
  }

  const [
    thresholds,
    narrativeHeat,
    btcReturn24h,
    history,
    gbpUsdRate,
    rulesState,
  ] = await Promise.all([
    loadThresholds(),
    loadNarrativeHeat(),
    loadBtcReturn24h(),
    loadHistory([...strategyPairs]),
    getGbpUsdRate(),
    loadRulesState(),
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
      gbpUsdRate,
      rulesState,
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

  // Composable strategy path. At most one composable strategy is
  // active at any time. Runs after the framework loop so a
  // misconfigured "both active" state still produces alerts from
  // the composable side last.
  if (activeStrategy && activeStrategy.source === 'composable') {
    const summary = await evaluateComposableStrategy({
      strategy: activeStrategy,
      markets,
      universeBySymbol,
      gbpUsdRate,
      rulesState,
      scanStartedAt: started,
      budgetState,
    })
    summaries.push(summary)
    totalScanned += summary.scanned
    totalTriggered += summary.triggered
  }

  // Position sync: poll the Hyperliquid main accounts that have linked
  // open trades, write a snapshot for each still-open position, and
  // detect closes by comparing the live trade list against the live
  // position list.
  let positionsTracked = 0
  let positionsClosed = 0
  if (Date.now() - started < 50_000) {
    const syncSummary = await syncHyperliquidPositions({
      scanStartedAt: started,
      gbpUsdRate,
    })
    positionsTracked = syncSummary.tracked
    positionsClosed = syncSummary.closed
    if (syncSummary.tracked > 0 || syncSummary.closed > 0) {
      console.log(
        `[scanner] hyperliquid sync tracked=${syncSummary.tracked} closed=${syncSummary.closed}`,
      )
    }
  } else {
    console.warn('[scanner] skipping Hyperliquid sync, scan budget exhausted')
  }

  return {
    scanned: totalScanned,
    triggered: totalTriggered,
    durationMs: Date.now() - started,
    truncated: budgetState.truncated,
    strategies: summaries,
    positionsTracked,
    positionsClosed,
  }
}

type SyncSummary = { tracked: number; closed: number }

async function loadHyperliquidConfigs(): Promise<HyperliquidConfigRow[]> {
  const client = supabase()
  const { data, error } = await client
    .from('user_hyperliquid_config')
    .select('tenant_id, main_address')
  if (error) {
    console.warn(`[scanner] hyperliquid config load failed: ${error.message}`)
    return []
  }
  return (data ?? []) as HyperliquidConfigRow[]
}

async function loadLiveTrades(tenantId: string): Promise<LiveTradeRow[]> {
  const client = supabase()
  const { data, error } = await client
    .from('trades')
    .select('id, tenant_id, asset_symbol, direction, entry_price, linked_at')
    .eq('tenant_id', tenantId)
    .eq('live_status', 'live')
  if (error) {
    console.warn(
      `[scanner] live trades load failed (tenant=${tenantId}): ${error.message}`,
    )
    return []
  }
  return (data ?? []) as LiveTradeRow[]
}

function findPositionForTrade(
  positions: HyperliquidPosition[],
  trade: LiveTradeRow,
): HyperliquidPosition | undefined {
  const wantedSign = trade.direction === 'long' ? 1 : -1
  return positions.find((p) => {
    if (p.coin !== trade.asset_symbol) return false
    const sign = p.szi >= 0 ? 1 : -1
    return sign === wantedSign
  })
}

async function recordPositionSnapshot(
  trade: LiveTradeRow,
  position: HyperliquidPosition,
): Promise<void> {
  const client = supabase()
  const nowIso = new Date().toISOString()
  const [{ error: snapshotError }, { error: tradeError }] = await Promise.all([
    client.from('hyperliquid_position_snapshots').insert({
      tenant_id: trade.tenant_id,
      trade_id: trade.id,
      coin: position.coin,
      size: position.szi,
      entry_px: position.entryPx,
      position_value: position.positionValue,
      unrealized_pnl: position.unrealizedPnl,
      liquidation_px: position.liquidationPx,
    }),
    client
      .from('trades')
      .update({ last_synced_at: nowIso })
      .eq('id', trade.id)
      .eq('tenant_id', trade.tenant_id),
  ])
  if (snapshotError) {
    console.warn(
      `[scanner] snapshot insert failed for trade ${trade.id}: ${snapshotError.message}`,
    )
  }
  if (tradeError) {
    console.warn(
      `[scanner] last_synced_at update failed for trade ${trade.id}: ${tradeError.message}`,
    )
  }
}

async function detectAndApplyClose(
  mainAddress: string,
  trade: LiveTradeRow,
  gbpUsdRate: number,
): Promise<boolean> {
  const closeDir = trade.direction === 'long' ? 'Close Long' : 'Close Short'
  const linkedAt = trade.linked_at
    ? Date.parse(trade.linked_at)
    : Date.now() - 7 * 24 * 60 * 60 * 1000
  let fills
  try {
    fills = await getUserFills(mainAddress, linkedAt)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[scanner] fills load failed for ${trade.id}: ${message}`)
    return false
  }
  const matching = fills
    .filter((f) => f.coin === trade.asset_symbol && f.dir === closeDir)
    .sort((a, b) => b.time - a.time)
  const close = matching[0]
  if (!close) return false

  const sign = trade.direction === 'long' ? 1 : -1
  const pnlUsd = (close.px - trade.entry_price) * close.sz * sign
  const outcome = pnlUsd > 0 ? 'win' : pnlUsd < 0 ? 'loss' : 'breakeven'

  const client = supabase()
  // The conditional eq on live_status='live' is the safety net
  // against racing a manual close: if the user updated the trade
  // first, live_status will already be 'closed_manual' and this
  // update is a no-op.
  const { data, error } = await client
    .from('trades')
    .update({
      exit_price: close.px,
      exit_size: close.sz,
      exit_at: new Date(close.time).toISOString(),
      pnl: pnlUsd,
      outcome,
      live_status: 'closed_auto',
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', trade.id)
    .eq('tenant_id', trade.tenant_id)
    .eq('live_status', 'live')
    .select('id')
  if (error) {
    console.warn(
      `[scanner] close update failed for ${trade.id}: ${error.message}`,
    )
    return false
  }
  const updated = (data ?? []).length > 0
  if (!updated) return false

  const pnlGbp = gbpUsdRate > 0 ? pnlUsd / gbpUsdRate : pnlUsd
  const ok = await sendTelegramClose({
    symbol: trade.asset_symbol,
    direction: trade.direction,
    entry: trade.entry_price,
    exit: close.px,
    pnlGbp,
    rMultiple: null,
    outcome,
    appUrl: `${APP_URL}/journal`,
  })
  if (!ok) {
    console.warn(`[scanner] close notification skipped for ${trade.id}`)
  }
  return true
}

async function syncHyperliquidPositions(args: {
  scanStartedAt: number
  gbpUsdRate: number
}): Promise<SyncSummary> {
  const summary: SyncSummary = { tracked: 0, closed: 0 }
  const configs = await loadHyperliquidConfigs()
  if (configs.length === 0) return summary

  for (const config of configs) {
    if (Date.now() - args.scanStartedAt > 50_000) {
      console.warn('[scanner] Hyperliquid sync truncated, resuming next tick')
      break
    }
    let state
    try {
      state = await getUserState(config.main_address)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[scanner] userState failed for ${config.main_address}: ${message}`,
      )
      continue
    }
    const trades = await loadLiveTrades(config.tenant_id)
    for (const trade of trades) {
      const position = findPositionForTrade(state.positions, trade)
      if (position) {
        await recordPositionSnapshot(trade, position)
        summary.tracked++
        continue
      }
      const closed = await detectAndApplyClose(
        config.main_address,
        trade,
        args.gbpUsdRate,
      )
      if (closed) summary.closed++
    }
  }

  return summary
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
