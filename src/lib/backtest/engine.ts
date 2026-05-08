// Backtest simulation engine.
//
// Walks every candle across the requested pairs in chronological
// order. At each closing candle it asks the configured framework
// whether a signal fires, applies the same risk rules the live
// scanner uses, and either opens a simulated position or records the
// signal as rules-blocked. Open positions are checked for stop or
// target hits against later candles, with timeout and end-of-period
// fallbacks so nothing stays open forever.
//
// The engine is deliberately lookahead-free: it evaluates at the
// close of candle N and assumes any resulting trade enters at the
// open of candle N+1. Same-bar exit logic is pessimistic: when both
// stop and target sit inside a bar, we assume the stop hit first.
// This trades optimistic fills for a more honest expectancy estimate.

import 'server-only'

import { FRAMEWORKS, type MarketSnapshot } from '@/lib/frameworks'
import type { Candle } from '@/lib/hyperliquid'
import { evaluateStrategy } from '@/lib/strategies/evaluator'
import '@/lib/strategies/register'
import type {
  EvaluationContext,
  StrategyDefinition,
} from '@/lib/strategies/types'

import { ensureCandles } from './candles'
import {
  FRAMEWORK_WARMUP_CANDLES,
  TIMEFRAME_MS,
  TIMEOUT_CANDLES,
  backtestSource,
  type BacktestCandle,
  type BacktestConfig,
  type BacktestDiagnostics,
  type BacktestDiagnosticsPair,
  type RunBacktestResult,
  type SimulatedTrade,
  type SimulatedTradeOutcome,
} from './types'

// Param keys that drive a condition's lookback. The engine reads
// them off every condition (and the exit rules, which carry their
// fields at the top level rather than under params) to compute how
// many trailing candles the evaluator needs.
const WARMUP_PARAM_KEYS = [
  'period',
  'lookback',
  'slow_period',
  'k_period',
  'd_period',
  'smooth',
  'lookback_candles',
  'sma_period',
  'ema_period',
] as const

const WARMUP_BUFFER_CANDLES = 50
const WARMUP_PARAM_HARD_CAP = 1000

// Minimum trailing window. Mirrors the legacy framework path so a
// strategy with only short-lookback conditions still gets the same
// 60-candle context the old engine assumed.
const MIN_WARMUP_CANDLES = FRAMEWORK_WARMUP_CANDLES

function maxParamValue(
  source: Record<string, unknown> | undefined | null,
): number {
  if (!source) return 0
  let max = 0
  for (const key of WARMUP_PARAM_KEYS) {
    const raw = source[key]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    let value = raw
    if (value > WARMUP_PARAM_HARD_CAP) {
      console.warn(
        `[backtest] warmup param ${key}=${value} exceeds ${WARMUP_PARAM_HARD_CAP}; clamping`,
      )
      value = WARMUP_PARAM_HARD_CAP
    }
    if (value > max) max = value
  }
  return max
}

// Pulls the largest indicator lookback param out of a composable
// strategy. Same walk used by computeStrategyWarmup but without
// the buffer / floor; surfaced for diagnostics so the UI can flag
// strategies whose indicators outsize the warmup window the engine
// chose.
export function collectMaxParamLookback(
  definition: StrategyDefinition,
): number {
  let max = 0
  for (const group of definition.entry.groups) {
    for (const condition of group.conditions) {
      const params = condition.params as Record<string, unknown> | undefined
      const v = maxParamValue(params)
      if (v > max) max = v
    }
  }
  const stopMax = maxParamValue(
    definition.exit.stop as unknown as Record<string, unknown>,
  )
  const targetMax = maxParamValue(
    definition.exit.target as unknown as Record<string, unknown>,
  )
  if (stopMax > max) max = stopMax
  if (targetMax > max) max = targetMax
  return max
}

// Pulls the largest indicator lookback out of a composable
// strategy. The result drives both the candle pre-fetch (so the
// trailing window is full by the time the strategy starts being
// evaluated) and the trailing window slice inside the loop. Floors
// at MIN_WARMUP_CANDLES so short strategies behave the same as the
// legacy framework path.
export function computeStrategyWarmup(
  definition: StrategyDefinition,
): number {
  return Math.max(
    MIN_WARMUP_CANDLES,
    collectMaxParamLookback(definition) + WARMUP_BUFFER_CANDLES,
  )
}

const FRANKFURTER_URL = 'https://api.frankfurter.app'
const GBP_USD_FALLBACK = 1.27

// Cap position notional at 100x the risk amount. Without this, a
// pathologically tight stop (e.g. perCoinRisk = $0.01 from a price
// glitch or noisy framework signal) lets `sizeCoin = riskUsd /
// perCoinRisk` blow up into a million-dollar position whose fees
// and PnL bear no resemblance to anything tradeable on a real
// exchange. Trades that would breach this land in blocked_signals
// with a clear reason rather than executing.
const MAX_NOTIONAL_MULTIPLIER = 100

type OpenPosition = {
  pair: string
  direction: 'long' | 'short'
  entry_at: Date
  entry_candle_open_at: Date
  entry_price: number
  stop_price: number
  target_price: number
  size_coin: number
  size_usd: number
  // GBP risk the engine actually sized this position against. For
  // composable strategies this is the strategy's own
  // sizing.amount; for legacy framework strategies it is
  // config.risk_amount_gbp. Stored on the position so R-multiple
  // is computed against the same denominator the position was
  // sized against, regardless of the entry path.
  risk_gbp_used: number
  conditions_at_signal: Record<string, unknown>
  candles_open: number
}

type SimState = {
  open_positions: Map<string, OpenPosition>
  closed_trades: SimulatedTrade[]
  blocked_signals: SimulatedTrade[]
  daily_pnl_gbp: Map<string, number>
  consecutive_losers: number
  last_loss_at: Date | null
  signals_total: number
  signals_blocked: number
}

// Rough proxy for the GBP/USD rate at the end of the backtest
// period. v1 uses a constant rate per run for simplicity; storing
// the rate that was used keeps results reproducible.
async function fetchGbpUsdRate(referenceDate: Date): Promise<number> {
  const today = new Date()
  const isFuture = referenceDate.getTime() > today.getTime()
  const dateParam = isFuture
    ? 'latest'
    : referenceDate.toISOString().slice(0, 10)
  try {
    const res = await fetch(`${FRANKFURTER_URL}/${dateParam}?from=GBP&to=USD`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return GBP_USD_FALLBACK
    const data = (await res.json()) as { rates?: { USD?: number } }
    const rate = data.rates?.USD
    return rate && Number.isFinite(rate) && rate > 0 ? rate : GBP_USD_FALLBACK
  } catch {
    return GBP_USD_FALLBACK
  }
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// Hyperliquid Candle shape (`{ t, o, h, l, c, v }`) is what the
// frameworks expect on snapshot.candles. Convert from BacktestCandle
// once at the boundary.
function toHyperliquidCandle(c: BacktestCandle): Candle {
  return {
    t: c.candle_open_at.getTime(),
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
    v: c.volume,
  }
}

function applySlippage(
  price: number,
  slippagePct: number,
  worsenForDirection: 'long-entry' | 'short-entry' | 'long-exit' | 'short-exit',
): number {
  const factor = slippagePct / 100
  switch (worsenForDirection) {
    case 'long-entry':
      return price * (1 + factor)
    case 'short-entry':
      return price * (1 - factor)
    case 'long-exit':
      return price * (1 - factor)
    case 'short-exit':
      return price * (1 + factor)
  }
}

function computePnlUsd(
  position: OpenPosition,
  exitPrice: number,
  feePct: number,
): number {
  const grossUsd =
    position.direction === 'long'
      ? (exitPrice - position.entry_price) * position.size_coin
      : (position.entry_price - exitPrice) * position.size_coin
  // Fees apply to both entry and exit notional. Same fee tier on
  // both sides because v1 assumes taker fills throughout.
  const entryNotional = position.entry_price * position.size_coin
  const exitNotional = exitPrice * position.size_coin
  const feeUsd = ((entryNotional + exitNotional) * feePct) / 100
  return grossUsd - feeUsd
}

function classifyOutcome(pnlGbp: number): SimulatedTradeOutcome {
  if (pnlGbp > 0.01) return 'win'
  if (pnlGbp < -0.01) return 'loss'
  return 'breakeven'
}

// Builds a unified, chronologically sorted timeline across all pairs.
// Each entry includes the index of that candle within its pair's
// own array so the engine can grab a trailing window for framework
// evaluation without re-scanning.
type TimelineEntry = {
  pair: string
  index: number
  candle: BacktestCandle
}

function buildTimeline(
  perPairCandles: Map<string, BacktestCandle[]>,
): TimelineEntry[] {
  const timeline: TimelineEntry[] = []
  perPairCandles.forEach((candles, pair) => {
    candles.forEach((candle, index) => {
      timeline.push({ pair, index, candle })
    })
  })
  timeline.sort(
    (a, b) =>
      a.candle.candle_open_at.getTime() - b.candle.candle_open_at.getTime(),
  )
  return timeline
}

function checkExits(
  state: SimState,
  entry: TimelineEntry,
  feePct: number,
  slippagePct: number,
  gbpUsdRate: number,
): void {
  const open = state.open_positions.get(entry.pair)
  if (!open) return
  // Skip the candle on which the position was actually opened so
  // we never use the same bar's range as both fill and exit.
  if (
    entry.candle.candle_open_at.getTime() <= open.entry_candle_open_at.getTime()
  ) {
    return
  }

  const candle = entry.candle
  const high = candle.high
  const low = candle.low

  let exitPrice: number | null = null
  let exitReason: 'target_hit' | 'stop_hit' | 'timeout' | null = null

  if (open.direction === 'long') {
    const stopHit = low <= open.stop_price
    const targetHit = high >= open.target_price
    if (stopHit && targetHit) {
      // Pessimistic: assume stop hit first inside the bar.
      exitPrice = applySlippage(open.stop_price, slippagePct, 'long-exit')
      exitReason = 'stop_hit'
    } else if (stopHit) {
      exitPrice = applySlippage(open.stop_price, slippagePct, 'long-exit')
      exitReason = 'stop_hit'
    } else if (targetHit) {
      exitPrice = applySlippage(open.target_price, slippagePct, 'long-exit')
      exitReason = 'target_hit'
    }
  } else {
    const stopHit = high >= open.stop_price
    const targetHit = low <= open.target_price
    if (stopHit && targetHit) {
      exitPrice = applySlippage(open.stop_price, slippagePct, 'short-exit')
      exitReason = 'stop_hit'
    } else if (stopHit) {
      exitPrice = applySlippage(open.stop_price, slippagePct, 'short-exit')
      exitReason = 'stop_hit'
    } else if (targetHit) {
      exitPrice = applySlippage(open.target_price, slippagePct, 'short-exit')
      exitReason = 'target_hit'
    }
  }

  if (exitPrice !== null && exitReason !== null) {
    closePosition(
      state,
      open,
      exitPrice,
      candle.candle_open_at,
      exitReason,
      feePct,
      gbpUsdRate,
    )
    return
  }

  open.candles_open += 1
}

function maybeTimeout(
  state: SimState,
  entry: TimelineEntry,
  timeoutCandles: number,
  feePct: number,
  gbpUsdRate: number,
): void {
  const open = state.open_positions.get(entry.pair)
  if (!open) return
  if (open.candles_open < timeoutCandles) return

  closePosition(
    state,
    open,
    entry.candle.close,
    entry.candle.candle_open_at,
    'timeout',
    feePct,
    gbpUsdRate,
  )
}

function closePosition(
  state: SimState,
  position: OpenPosition,
  exitPrice: number,
  exitAt: Date,
  exitReason: 'target_hit' | 'stop_hit' | 'timeout' | 'open_at_period_end',
  feePct: number,
  gbpUsdRate: number,
): void {
  const pnlUsd = computePnlUsd(position, exitPrice, feePct)
  const pnlGbp = pnlUsd / gbpUsdRate
  const outcome = classifyOutcome(pnlGbp)
  // Always normalise R against the GBP risk this specific position
  // was sized against (not the run-level config). For a composable
  // strategy with a £30 sizing rule, a stop hit at -£30 lands as
  // R = -1, regardless of what the legacy config.risk_amount_gbp
  // happens to be.
  const rMultiple =
    position.risk_gbp_used > 0 ? pnlGbp / position.risk_gbp_used : 0

  const trade: SimulatedTrade = {
    pair: position.pair,
    direction: position.direction,
    entry_at: position.entry_at,
    entry_price: position.entry_price,
    stop_price: position.stop_price,
    target_price: position.target_price,
    exit_at: exitAt,
    exit_price: exitPrice,
    exit_reason: exitReason,
    size_coin: position.size_coin,
    size_usd: position.size_usd,
    pnl_usd: pnlUsd,
    pnl_gbp: pnlGbp,
    r_multiple: rMultiple,
    outcome,
    conditions_at_signal: position.conditions_at_signal,
  }

  state.closed_trades.push(trade)
  state.open_positions.delete(position.pair)

  const day = isoDay(exitAt)
  state.daily_pnl_gbp.set(day, (state.daily_pnl_gbp.get(day) ?? 0) + pnlGbp)

  if (outcome === 'loss') {
    state.consecutive_losers += 1
    state.last_loss_at = exitAt
  } else if (outcome === 'win') {
    state.consecutive_losers = 0
  }
}

type RuleViolation = { rule: string; reason: string }

function evaluateRules(
  state: SimState,
  config: BacktestConfig,
  proposedRiskGbp: number,
  signalAt: Date,
  rrRatio: number,
): RuleViolation[] {
  const violations: RuleViolation[] = []

  if (state.open_positions.size >= config.max_concurrent_positions) {
    violations.push({
      rule: 'max_concurrent_positions',
      reason: `Already at ${state.open_positions.size}/${config.max_concurrent_positions} open positions`,
    })
  }

  if (config.max_daily_loss_gbp != null) {
    const today = isoDay(signalAt)
    const realised = state.daily_pnl_gbp.get(today) ?? 0
    const projected = realised - proposedRiskGbp
    if (-projected > config.max_daily_loss_gbp) {
      violations.push({
        rule: 'max_daily_loss',
        reason: `Daily loss cap would be exceeded`,
      })
    }
  }

  if (
    config.max_consecutive_losers != null &&
    state.consecutive_losers >= config.max_consecutive_losers &&
    state.last_loss_at !== null
  ) {
    const hoursSinceLoss =
      (signalAt.getTime() - state.last_loss_at.getTime()) / 3_600_000
    if (hoursSinceLoss < 24) {
      violations.push({
        rule: 'consecutive_losers_pause',
        reason: `${state.consecutive_losers} consecutive losses, cooling-off period`,
      })
    }
  }

  if (rrRatio < config.min_rr) {
    violations.push({
      rule: 'rr_below_min',
      reason: `R:R ${rrRatio.toFixed(2)} below minimum ${config.min_rr}`,
    })
  }

  return violations
}

// Internal shape produced by either source. The engine's main
// loop only ever sees this; everything downstream (slippage,
// rules gating, sizing, position management) is source-agnostic.
type EngineSignal = {
  direction: 'long' | 'short'
  raw_entry: number
  raw_stop: number
  raw_target: number
  condition_values: Record<string, unknown>
}

// Inner-loop sink for condition failure stats. Plain object maps to
// keep the hit count site as a fast property store/load; allocated
// once per run and mutated in place. Engine calls the recorder
// callback at most once per group per failed evaluation, so on a
// 100k-evaluation 1-group strategy the recorder is touched at most
// 100k times — negligible compared to the indicator math itself.
type FailureRecorder = (conditionType: string, insufficientData: boolean) => void

type SignalEvaluator = (pair: string, trailing: Candle[]) => EngineSignal | null

function buildSignalEvaluator(
  config: BacktestConfig,
  recordFailure: FailureRecorder,
): SignalEvaluator {
  if (backtestSource(config) === 'framework') {
    if (!config.framework_id) {
      throw new Error('framework_id required for framework-source backtest')
    }
    const framework = FRAMEWORKS.get(config.framework_id)
    if (!framework) {
      throw new Error(`Unknown framework: ${config.framework_id}`)
    }
    const thresholds = config.framework_thresholds ?? {}
    return (pair, trailing) => {
      const last = trailing[trailing.length - 1]!
      const snapshot: MarketSnapshot = {
        symbol: pair,
        markPrice: last.c,
        funding: 0,
        openInterest: 0,
        dayNotionalVolume: 0,
        candles: trailing,
      }
      const result = framework.evaluate(snapshot, thresholds)
      if (
        !result.triggered ||
        !result.suggestedDirection ||
        result.suggestedEntry === undefined ||
        result.suggestedStop === undefined ||
        result.suggestedTarget === undefined
      ) {
        // Legacy frameworks do not surface a structured "which
        // condition blocked the signal" so the diagnostics ledger
        // simply records the framework as the failing unit. The
        // composable path below feeds finer-grained data.
        recordFailure(`framework:${config.framework_id}`, false)
        return null
      }
      return {
        direction: result.suggestedDirection,
        raw_entry: result.suggestedEntry,
        raw_stop: result.suggestedStop,
        raw_target: result.suggestedTarget,
        condition_values: result.conditionValues,
      }
    }
  }

  // Composable strategy_definition path. The snapshot must be
  // present; the action layer is responsible for hydrating it
  // before calling runBacktest.
  const definition = config.strategy_definition_snapshot
  if (!definition) {
    throw new Error(
      'strategy_definition_snapshot required for composable-source backtest',
    )
  }
  return (_pair, trailing) => {
    const last = trailing[trailing.length - 1]!
    const ctx: EvaluationContext = {
      candles: trailing,
      currentCandle: last,
      currentPrice: last.c,
      // Backtest data does not carry historical funding yet, so
      // funding-dependent conditions return passed=false with a
      // missing_data flag rather than triggering on stale data.
      funding: undefined,
    }
    const result = evaluateStrategy(definition, ctx)
    if (
      !result.triggered ||
      !result.direction ||
      result.entry_price === undefined ||
      result.stop_price === undefined ||
      result.target_price === undefined
    ) {
      const failures = result.group_failures
      if (failures) {
        for (let i = 0; i < failures.length; i++) {
          const f = failures[i]!
          recordFailure(f.condition_type, f.insufficient_data)
        }
      }
      return null
    }
    return {
      direction: result.direction,
      raw_entry: result.entry_price,
      raw_stop: result.stop_price,
      raw_target: result.target_price,
      condition_values: result.condition_values,
    }
  }
}

// Position sizing dispatch. Most strategies size off risk in GBP,
// matching the legacy framework path. Composable strategies may
// instead specify a fixed coin-denominated size, in which case
// risk-based math is bypassed.
function computeEntrySize(
  config: BacktestConfig,
  fillPrice: number,
  stopPrice: number,
  gbpUsdRate: number,
): { sizeCoin: number; sizeUsd: number; riskGbp: number } | null {
  const definition = config.strategy_definition_snapshot
  if (definition && definition.sizing.type === 'fixed_position_size') {
    const size = definition.sizing.size
    if (size <= 0) return null
    // Coin-denominated sizing: derive an effective GBP risk from
    // the actual stop distance so R-multiple stays meaningful.
    const perCoinRisk = Math.abs(fillPrice - stopPrice)
    const riskUsd = perCoinRisk * size
    const riskGbp = riskUsd / gbpUsdRate
    return { sizeCoin: size, sizeUsd: size * fillPrice, riskGbp }
  }
  // Composable fixed_gbp_risk uses the strategy's own per-trade
  // risk amount in GBP rather than the run-level config.risk_amount_gbp
  // that the legacy framework path relies on. Without this branch
  // the engine silently sized every composable trade off the form's
  // risk_amount_gbp value (which the batch form derived from
  // starting capital), inflating losses by orders of magnitude.
  if (definition && definition.sizing.type === 'fixed_gbp_risk') {
    const riskGbp = definition.sizing.amount
    if (riskGbp <= 0) return null
    const riskUsd = riskGbp * gbpUsdRate
    const perCoinRisk = Math.abs(fillPrice - stopPrice)
    if (perCoinRisk <= 0) return null
    const sizeCoin = riskUsd / perCoinRisk
    return { sizeCoin, sizeUsd: sizeCoin * fillPrice, riskGbp }
  }
  const riskGbp = config.risk_amount_gbp
  const riskUsd = riskGbp * gbpUsdRate
  const perCoinRisk = Math.abs(fillPrice - stopPrice)
  if (perCoinRisk <= 0) return null
  const sizeCoin = riskUsd / perCoinRisk
  return { sizeCoin, sizeUsd: sizeCoin * fillPrice, riskGbp }
}

export async function runBacktest(
  config: BacktestConfig,
): Promise<RunBacktestResult> {
  if (config.pairs.length === 0) {
    throw new Error('At least one pair is required')
  }
  if (config.date_range_end.getTime() <= config.date_range_start.getTime()) {
    throw new Error('date_range_end must be after date_range_start')
  }

  // Diagnostics counters. Plain object maps so the hot path stays
  // on V8's monomorphic property-store fast path. The closures
  // below increment these in place; nothing allocates per
  // evaluation other than what the evaluator already does.
  const conditionFailureBreakdown: Record<string, number> = {}
  const conditionInsufficientData: Record<string, number> = {}
  const recordFailure: FailureRecorder = (
    conditionType,
    insufficientData,
  ) => {
    conditionFailureBreakdown[conditionType] =
      (conditionFailureBreakdown[conditionType] ?? 0) + 1
    if (insufficientData) {
      conditionInsufficientData[conditionType] =
        (conditionInsufficientData[conditionType] ?? 0) + 1
    }
  }
  const perPairDiag: Record<string, BacktestDiagnosticsPair> = {}
  for (const pair of config.pairs) {
    perPairDiag[pair] = {
      candles_loaded: 0,
      candles_evaluated: 0,
      long_evaluations: 0,
      short_evaluations: 0,
      signals: 0,
    }
  }
  let evaluationsTotal = 0
  let firstSignalAt: Date | null = null
  let lastSignalAt: Date | null = null

  const evaluateSignal = buildSignalEvaluator(config, recordFailure)

  const gbpUsdRate = await fetchGbpUsdRate(config.date_range_end)

  // Composable strategies size the warmup window from their own
  // condition / rule lookbacks; legacy frameworks keep the fixed
  // 60-candle context they were built against. Either way, the
  // warmup is also used to pre-fetch enough history before the
  // requested date range that the trailing window is full from the
  // first signal-eligible candle.
  const warmupCandles =
    backtestSource(config) === 'strategy_definition' &&
    config.strategy_definition_snapshot
      ? computeStrategyWarmup(config.strategy_definition_snapshot)
      : FRAMEWORK_WARMUP_CANDLES

  const warmupParamMax =
    backtestSource(config) === 'strategy_definition' &&
    config.strategy_definition_snapshot
      ? collectMaxParamLookback(config.strategy_definition_snapshot)
      : 0

  const tfMs = TIMEFRAME_MS[config.timeframe]
  // Frameworks fetch only the user-requested range to preserve the
  // exact behaviour they had pre-fix; composable runs extend the
  // start backwards by `warmupCandles * tfMs` so that a strategy
  // with e.g. an EMA(200) filter has 200 closes to work with on the
  // very first candle of the user's intended date range.
  const fetchStart =
    backtestSource(config) === 'strategy_definition'
      ? new Date(config.date_range_start.getTime() - warmupCandles * tfMs)
      : config.date_range_start

  const perPairCandles = new Map<string, BacktestCandle[]>()
  for (const pair of config.pairs) {
    const candles = await ensureCandles(
      pair,
      config.timeframe,
      fetchStart,
      config.date_range_end,
    )
    perPairCandles.set(pair, candles)
    perPairDiag[pair]!.candles_loaded = candles.length
  }

  const timeline = buildTimeline(perPairCandles)

  const state: SimState = {
    open_positions: new Map(),
    closed_trades: [],
    blocked_signals: [],
    daily_pnl_gbp: new Map(),
    consecutive_losers: 0,
    last_loss_at: null,
    signals_total: 0,
    signals_blocked: 0,
  }

  const feePct = config.assume_taker
    ? config.taker_fee_pct
    : config.maker_fee_pct
  const timeoutCandles = TIMEOUT_CANDLES[config.timeframe]

  // Cache the directions the active strategy can fire so the loop
  // can split per-pair evaluations into long/short tallies without
  // re-reading the definition each iteration.
  const strategyDir =
    config.strategy_definition_snapshot?.direction ?? 'both'
  const evaluatesLong = strategyDir === 'long_only' || strategyDir === 'both'
  const evaluatesShort = strategyDir === 'short_only' || strategyDir === 'both'

  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i]!

    // Order matters: exits before timeouts before signal evaluation.
    // A target hit on the same bar that would otherwise time out
    // should be recorded as a target_hit, not a timeout.
    checkExits(state, entry, feePct, config.slippage_pct, gbpUsdRate)
    maybeTimeout(state, entry, timeoutCandles, feePct, gbpUsdRate)

    if (state.open_positions.has(entry.pair)) {
      // One position per pair at a time; do not stack signals.
      continue
    }

    const pairCandles = perPairCandles.get(entry.pair)!
    if (entry.index < warmupCandles) continue

    const trailing = pairCandles
      .slice(
        Math.max(0, entry.index - warmupCandles + 1),
        entry.index + 1,
      )
      .map(toHyperliquidCandle)

    // Diagnostics: count this as one evaluation against the pair.
    // The closure may further attribute the failure to a specific
    // condition via the recordFailure callback wired in to
    // buildSignalEvaluator.
    evaluationsTotal += 1
    const pairDiag = perPairDiag[entry.pair]
    if (pairDiag) {
      pairDiag.candles_evaluated += 1
      if (evaluatesLong) pairDiag.long_evaluations += 1
      if (evaluatesShort) pairDiag.short_evaluations += 1
    }

    const signal = evaluateSignal(entry.pair, trailing)
    if (!signal) continue

    state.signals_total += 1
    if (pairDiag) pairDiag.signals += 1
    if (firstSignalAt === null) firstSignalAt = entry.candle.candle_open_at
    lastSignalAt = entry.candle.candle_open_at

    const direction = signal.direction
    const rawEntry = signal.raw_entry
    const rawStop = signal.raw_stop
    const rawTarget = signal.raw_target

    // Lookahead avoidance: framework evaluates on close of candle N,
    // we open the trade at the open of candle N+1 on this pair. If
    // there is no next candle in this pair's series, we cannot fill,
    // so skip the signal.
    const nextCandle = pairCandles[entry.index + 1]
    if (!nextCandle) continue

    const fillPriceRaw = nextCandle.open
    const fillPrice = applySlippage(
      fillPriceRaw,
      config.slippage_pct,
      direction === 'long' ? 'long-entry' : 'short-entry',
    )

    // Reanchor stop and target around the actual fill so the
    // intended stop distance and R-multiple survive the slippage
    // adjustment. Without this, slippage flips trades into
    // immediate stop-outs or kills the R:R ratio.
    const intendedRisk = Math.abs(rawEntry - rawStop)
    const intendedReward = Math.abs(rawTarget - rawEntry)
    const stopPrice =
      direction === 'long' ? fillPrice - intendedRisk : fillPrice + intendedRisk
    const targetPrice =
      direction === 'long'
        ? fillPrice + intendedReward
        : fillPrice - intendedReward

    const rrRatio = intendedRisk > 0 ? intendedReward / intendedRisk : 0

    const violations = evaluateRules(
      state,
      config,
      config.risk_amount_gbp,
      nextCandle.candle_open_at,
      rrRatio,
    )

    if (violations.length > 0) {
      const placeholderSize = 0
      state.signals_blocked += 1
      state.blocked_signals.push({
        pair: entry.pair,
        direction,
        entry_at: nextCandle.candle_open_at,
        entry_price: fillPrice,
        stop_price: stopPrice,
        target_price: targetPrice,
        exit_at: null,
        exit_price: null,
        exit_reason: 'rules_blocked',
        size_coin: placeholderSize,
        size_usd: placeholderSize,
        pnl_usd: 0,
        pnl_gbp: 0,
        r_multiple: 0,
        outcome: 'breakeven',
        conditions_at_signal: {
          ...signal.condition_values,
          rules_violations: violations,
        },
      })
      continue
    }

    const sizeResult = computeEntrySize(
      config,
      fillPrice,
      stopPrice,
      gbpUsdRate,
    )
    if (!sizeResult) continue

    // Notional sanity cap. perCoinRisk too small (very tight stop)
    // would otherwise size a wildly oversized position; skip with a
    // visible reason so the operator can see why the strategy
    // appears to fire fewer trades than expected.
    const notionalCapUsd =
      MAX_NOTIONAL_MULTIPLIER * sizeResult.riskGbp * gbpUsdRate
    if (sizeResult.sizeUsd > notionalCapUsd) {
      state.signals_blocked += 1
      state.blocked_signals.push({
        pair: entry.pair,
        direction,
        entry_at: nextCandle.candle_open_at,
        entry_price: fillPrice,
        stop_price: stopPrice,
        target_price: targetPrice,
        exit_at: null,
        exit_price: null,
        exit_reason: 'rules_blocked',
        size_coin: 0,
        size_usd: 0,
        pnl_usd: 0,
        pnl_gbp: 0,
        r_multiple: 0,
        outcome: 'breakeven',
        conditions_at_signal: {
          ...signal.condition_values,
          rules_violations: [
            {
              rule: 'notional_cap',
              reason: `Sized notional $${sizeResult.sizeUsd.toFixed(0)} would exceed ${MAX_NOTIONAL_MULTIPLIER}× risk cap; stop distance too tight`,
            },
          ],
        },
      })
      continue
    }

    state.open_positions.set(entry.pair, {
      pair: entry.pair,
      direction,
      entry_at: nextCandle.candle_open_at,
      entry_candle_open_at: nextCandle.candle_open_at,
      entry_price: fillPrice,
      stop_price: stopPrice,
      target_price: targetPrice,
      size_coin: sizeResult.sizeCoin,
      size_usd: sizeResult.sizeUsd,
      risk_gbp_used: sizeResult.riskGbp,
      conditions_at_signal: { ...signal.condition_values },
      candles_open: 0,
    })
  }

  // End of timeline: any still-open positions close at the last
  // candle's close on their pair.
  state.open_positions.forEach((pos) => {
    const candles = perPairCandles.get(pos.pair) ?? []
    if (candles.length === 0) return
    const last = candles[candles.length - 1]!
    closePosition(
      state,
      pos,
      last.close,
      last.candle_open_at,
      'open_at_period_end',
      feePct,
      gbpUsdRate,
    )
  })

  const diagnostics: BacktestDiagnostics = {
    warmup_candles_used: warmupCandles,
    warmup_param_max: warmupParamMax,
    per_pair: perPairDiag,
    evaluations_total: evaluationsTotal,
    evaluations_passed: state.signals_total,
    evaluations_blocked_by_rules: state.signals_blocked,
    condition_failure_breakdown: conditionFailureBreakdown,
    condition_insufficient_data: conditionInsufficientData,
    first_signal_at: firstSignalAt ? firstSignalAt.toISOString() : null,
    last_signal_at: lastSignalAt ? lastSignalAt.toISOString() : null,
    sample_rate: 1,
  }

  return {
    trades: [...state.closed_trades, ...state.blocked_signals],
    signals_total: state.signals_total,
    signals_blocked_by_rules: state.signals_blocked,
    gbp_usd_rate_used: gbpUsdRate,
    diagnostics,
  }
}
