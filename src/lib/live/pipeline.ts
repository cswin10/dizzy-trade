import 'server-only'

// Live signal pipeline. Orchestrates the journey of one trade
// idea from "scanner detected a setup" through to "position
// closed and journalled":
//
//   buildOrderIntent       compute size / stop / target / risk
//   preflight              tenant-level guardrails (max positions,
//                            daily loss, consecutive losers, pair
//                            allowlist)
//   recordSignal           insert pending_confirmation row
//   onConfirm              place limit, store order id
//   tickPlacedOrder        check fill / expiry on each monitor tick
//   tickFilledPosition     check stop / target on each monitor tick
//   onClose                journal + notify
//
// All Supabase writes go through the service-role client passed
// in by the action layer so RLS plus tenant scoping are uniformly
// enforced one level up.

import { TIMEFRAME_MS } from '@/lib/backtest/types'
import { HARDCODED_SAFETY_LIMITS } from '@/lib/live/safety-limits'
import type { ExchangeClient } from '@/lib/exchange/factory'
import type { OrderStatus } from '@/lib/exchange/types'
import type { StrategyDefinition } from '@/lib/strategies/types'
import type { Database } from '@/types/database'

type Service = {
  from: (table: string) => any
}

const GBP_USD_FALLBACK = 1.27

export type DeploymentRow = Database['public']['Tables']['strategy_deployments']['Row']
export type LiveSignalRow = Database['public']['Tables']['live_signals']['Row']

export type SignalIntent = {
  pair: string
  direction: 'long' | 'short'
  signal_at: Date
  signal_close_price: number
  intended_entry_price: number
  intended_stop_price: number
  intended_target_price: number
  intended_size_coin: number
  intended_size_usd: number
  intended_risk_gbp: number
  intended_rr: number
}

// --- Order-intent builder ------------------------------------------

export type StrategySizing =
  | { kind: 'composable'; definition: StrategyDefinition }
  | { kind: 'legacy'; risk_gbp: number }

// Computes the same risk-anchored size the backtest engine uses,
// using either the composable strategy's sizing rule or the
// deployment-level fallback for legacy strategies. Returns null
// when the inputs imply zero size (e.g. stop equals entry, which
// would otherwise divide by zero).
export function buildOrderIntent(args: {
  pair: string
  direction: 'long' | 'short'
  signal_at: Date
  signal_close_price: number
  raw_stop_price: number
  raw_target_price: number
  sizing: StrategySizing
  deployment_risk_gbp: number
  gbp_usd_rate?: number
}): SignalIntent | null {
  const gbpUsd = args.gbp_usd_rate ?? GBP_USD_FALLBACK
  const direction = args.direction
  const entryPrice = args.signal_close_price
  const stopPrice = args.raw_stop_price
  const targetPrice = args.raw_target_price
  const perCoinRisk = Math.abs(entryPrice - stopPrice)
  if (perCoinRisk <= 0) return null

  let riskGbp: number
  if (args.sizing.kind === 'composable') {
    const sizing = args.sizing.definition.sizing
    if (sizing.type === 'fixed_position_size') {
      const sizeCoin = sizing.size
      const sizeUsd = sizeCoin * entryPrice
      const riskUsd = perCoinRisk * sizeCoin
      riskGbp = riskUsd / gbpUsd
      const reward = Math.abs(targetPrice - entryPrice)
      const rr = perCoinRisk > 0 ? reward / perCoinRisk : 0
      return {
        pair: args.pair,
        direction,
        signal_at: args.signal_at,
        signal_close_price: entryPrice,
        intended_entry_price: entryPrice,
        intended_stop_price: stopPrice,
        intended_target_price: targetPrice,
        intended_size_coin: sizeCoin,
        intended_size_usd: sizeUsd,
        intended_risk_gbp: riskGbp,
        intended_rr: rr,
      }
    }
    if (sizing.type === 'fixed_gbp_risk') {
      riskGbp = sizing.amount
    } else {
      // Sizing rule the engine doesn't know about. Fall back to
      // the deployment-level risk so the pipeline still produces
      // an intent rather than dropping the signal.
      riskGbp = args.deployment_risk_gbp
    }
  } else {
    riskGbp = args.sizing.risk_gbp
  }

  const riskUsd = riskGbp * gbpUsd
  const sizeCoin = riskUsd / perCoinRisk
  const sizeUsd = sizeCoin * entryPrice
  const reward = Math.abs(targetPrice - entryPrice)
  const rr = reward / perCoinRisk

  return {
    pair: args.pair,
    direction,
    signal_at: args.signal_at,
    signal_close_price: entryPrice,
    intended_entry_price: entryPrice,
    intended_stop_price: stopPrice,
    intended_target_price: targetPrice,
    intended_size_coin: sizeCoin,
    intended_size_usd: sizeUsd,
    intended_risk_gbp: riskGbp,
    intended_rr: rr,
  }
}

// --- Pre-flight checks ---------------------------------------------

export type PreflightSkipReason =
  | 'max_positions'
  | 'daily_loss'
  | 'consecutive_losers'
  | 'pair_not_allowed'
  | 'deployment_not_live'
  | 'safety_limit'

export type PreflightResult =
  | { ok: true; requires_manual_confirmation: boolean }
  | { ok: false; reason: PreflightSkipReason; detail: string }

// Reads only the live_signals belonging to this deployment so the
// guardrails track per-deployment, not per-tenant. A tenant
// running multiple deployments concurrently can hit max_positions
// on one without affecting the others.
//
// The hardcoded safety caps in src/lib/live/safety-limits.ts are
// applied tenant-wide BEFORE the per-deployment guardrails so a
// caller cannot route around them by spinning up a fresh
// deployment with looser settings.
export async function preflightCheck(
  service: Service,
  deployment: DeploymentRow,
  pair: string,
  intent: SignalIntent,
): Promise<PreflightResult> {
  // --- Hardcoded safety caps (run first; cannot be overridden) ---
  const safety = await checkHardcodedSafetyLimits(service, deployment, intent)
  if (!safety.ok) return safety

  if (deployment.status !== 'live') {
    return {
      ok: false,
      reason: 'deployment_not_live',
      detail: `deployment status is ${deployment.status}`,
    }
  }
  if (!deployment.live_pairs.includes(pair)) {
    return {
      ok: false,
      reason: 'pair_not_allowed',
      detail: `pair ${pair} is not in live_pairs`,
    }
  }
  // Open positions per deployment.
  const { count: openCount, error: openErr } = await service
    .from('live_signals')
    .select('id', { count: 'exact', head: true })
    .eq('deployment_id', deployment.id)
    .in('status', ['confirmed', 'order_placed', 'filled'])
  if (openErr) {
    return {
      ok: false,
      reason: 'max_positions',
      detail: `count failed: ${openErr.message}`,
    }
  }
  if (
    (openCount ?? 0) >= deployment.live_max_concurrent_positions
  ) {
    return {
      ok: false,
      reason: 'max_positions',
      detail: `already at ${openCount} of ${deployment.live_max_concurrent_positions} concurrent positions`,
    }
  }
  // Daily loss cap: sum realised_pnl_gbp across closed signals
  // today and refuse if the projected loss after this trade would
  // exceed the cap.
  if (
    deployment.live_max_daily_loss_gbp !== null &&
    deployment.live_max_daily_loss_gbp !== undefined
  ) {
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const { data: closedToday, error: lossErr } = await service
      .from('live_signals')
      .select('realised_pnl_gbp')
      .eq('deployment_id', deployment.id)
      .gte('closed_at', todayStart.toISOString())
    if (lossErr) {
      return {
        ok: false,
        reason: 'daily_loss',
        detail: `loss query failed: ${lossErr.message}`,
      }
    }
    const realised = (closedToday ?? [])
      .map((r: { realised_pnl_gbp: number | null }) =>
        r.realised_pnl_gbp == null ? 0 : Number(r.realised_pnl_gbp),
      )
      .reduce((a: number, b: number) => a + b, 0)
    if (-realised >= Number(deployment.live_max_daily_loss_gbp)) {
      return {
        ok: false,
        reason: 'daily_loss',
        detail: `daily loss cap of £${Number(deployment.live_max_daily_loss_gbp)} reached (current £${realised.toFixed(2)})`,
      }
    }
  }
  // Consecutive losers: walk recent closed signals from newest to
  // oldest and count losses up to the first non-loss.
  if (
    deployment.live_max_consecutive_losers !== null &&
    deployment.live_max_consecutive_losers !== undefined
  ) {
    const { data: recent, error: streakErr } = await service
      .from('live_signals')
      .select('realised_pnl_gbp, closed_at, status')
      .eq('deployment_id', deployment.id)
      .in('status', ['closed_at_stop', 'closed_at_target'])
      .order('closed_at', { ascending: false })
      .limit(deployment.live_max_consecutive_losers + 1)
    if (streakErr) {
      return {
        ok: false,
        reason: 'consecutive_losers',
        detail: `streak query failed: ${streakErr.message}`,
      }
    }
    let streak = 0
    for (const r of recent ?? []) {
      const pnl = r.realised_pnl_gbp == null ? 0 : Number(r.realised_pnl_gbp)
      if (pnl < 0) streak += 1
      else break
    }
    if (streak >= deployment.live_max_consecutive_losers) {
      return {
        ok: false,
        reason: 'consecutive_losers',
        detail: `${streak} consecutive losers reached`,
      }
    }
  }
  // requires_manual_confirmation is forward-looking. Phase 2b
  // pipeline already mandates manual confirmation for every
  // signal; the flag is computed here so a future auto-execute
  // path can read it directly off the live_signals row without
  // re-counting closed trades.
  const closedCount = await countClosedTradesForTenant(
    service,
    deployment.tenant_id,
  )
  const requiresManual =
    closedCount < HARDCODED_SAFETY_LIMITS.REQUIRE_MANUAL_CONFIRMATION_FIRST_N_TRADES
  return { ok: true, requires_manual_confirmation: requiresManual }
}

// Hardcoded floor enforced before any per-deployment / per-pair
// check. The caller passes the already-sized SignalIntent so we
// can validate notional and risk in one place; daily-loss and
// concurrent-position counts span every live deployment for the
// tenant, not just the one firing the signal.
async function checkHardcodedSafetyLimits(
  service: Service,
  deployment: DeploymentRow,
  intent: SignalIntent,
): Promise<PreflightResult> {
  const c = HARDCODED_SAFETY_LIMITS

  const notionalUsd = intent.intended_size_usd
  if (notionalUsd > c.MAX_NOTIONAL_USD_PER_TRADE) {
    return {
      ok: false,
      reason: 'safety_limit',
      detail: `Notional $${notionalUsd.toFixed(2)} exceeds hardcoded cap of $${c.MAX_NOTIONAL_USD_PER_TRADE}`,
    }
  }
  if (intent.intended_risk_gbp > c.MAX_RISK_GBP_PER_TRADE) {
    return {
      ok: false,
      reason: 'safety_limit',
      detail: `Risk £${intent.intended_risk_gbp.toFixed(2)} exceeds hardcoded cap of £${c.MAX_RISK_GBP_PER_TRADE} per trade`,
    }
  }

  // Rolling 24h loss across every live signal for the tenant.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: closedRecent, error: lossErr } = await service
    .from('live_signals')
    .select('realised_pnl_gbp')
    .eq('tenant_id', deployment.tenant_id)
    .gte('closed_at', since)
  if (lossErr) {
    return {
      ok: false,
      reason: 'safety_limit',
      detail: `daily-loss query failed: ${lossErr.message}`,
    }
  }
  const realised = (closedRecent ?? [])
    .map((r: { realised_pnl_gbp: number | null }) =>
      r.realised_pnl_gbp == null ? 0 : Number(r.realised_pnl_gbp),
    )
    .reduce((a: number, b: number) => a + b, 0)
  if (-realised >= c.MAX_DAILY_LOSS_GBP) {
    return {
      ok: false,
      reason: 'safety_limit',
      detail: `Daily loss £${(-realised).toFixed(2)} already at hardcoded cap of £${c.MAX_DAILY_LOSS_GBP}`,
    }
  }

  // Tenant-wide concurrent position count.
  const { count: openCount, error: posErr } = await service
    .from('live_signals')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', deployment.tenant_id)
    .in('status', ['order_placed', 'filled'])
  if (posErr) {
    return {
      ok: false,
      reason: 'safety_limit',
      detail: `concurrent-position query failed: ${posErr.message}`,
    }
  }
  if ((openCount ?? 0) >= c.MAX_CONCURRENT_POSITIONS_GLOBAL) {
    return {
      ok: false,
      reason: 'safety_limit',
      detail: `Already at hardcoded cap of ${c.MAX_CONCURRENT_POSITIONS_GLOBAL} concurrent position${c.MAX_CONCURRENT_POSITIONS_GLOBAL === 1 ? '' : 's'} (${openCount} open)`,
    }
  }
  return { ok: true, requires_manual_confirmation: false }
}

async function countClosedTradesForTenant(
  service: Service,
  tenantId: string,
): Promise<number> {
  const { count } = await service
    .from('live_signals')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .in('status', ['closed_at_stop', 'closed_at_target'])
  return count ?? 0
}

// --- Signal recording ---------------------------------------------

const TIMEFRAME_TO_MS_MAP: Record<string, number> = TIMEFRAME_MS as Record<string, number>

export function computeExpiryAt(
  signalAt: Date,
  timeframe: string,
  lifetimeCandles: number,
): Date {
  const tfMs = TIMEFRAME_TO_MS_MAP[timeframe] ?? 60 * 60 * 1000
  return new Date(signalAt.getTime() + tfMs * lifetimeCandles)
}

export function preflightSkipStatus(
  reason: PreflightSkipReason,
):
  | 'skipped_max_positions'
  | 'skipped_daily_loss'
  | 'skipped_consecutive_losers'
  | 'skipped_safety_limit'
  | 'failed' {
  switch (reason) {
    case 'max_positions':
      return 'skipped_max_positions'
    case 'daily_loss':
      return 'skipped_daily_loss'
    case 'consecutive_losers':
      return 'skipped_consecutive_losers'
    case 'safety_limit':
      return 'skipped_safety_limit'
    default:
      return 'failed'
  }
}

// Composes a client_order_id that is stable across retries of the
// same signal. Using the live_signals.id satisfies the mock
// client's idempotency check and will be just as good for the
// real Hyperliquid client in Phase 2.
export function clientOrderIdForSignal(signalId: string, role: 'entry' | 'stop' | 'tp'): string {
  return `${signalId}:${role}`
}

// --- Confirmation flow --------------------------------------------

export async function placeEntryOrder(
  service: Service,
  client: ExchangeClient,
  signal: LiveSignalRow,
  expiresAt: Date,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cloid = clientOrderIdForSignal(signal.id, 'entry')
  const result = await client.placeLimitOrder({
    client_order_id: cloid,
    pair: signal.pair,
    side: signal.direction,
    size_coin: Number(signal.intended_size_coin),
    limit_price: Number(signal.intended_entry_price),
    expires_at: expiresAt,
  })
  if (!result.ok) {
    const { error: failedWriteError } = await service
      .from('live_signals')
      .update({
        status: 'failed',
        failure_reason: result.reason,
        cloid,
      })
      .eq('id', signal.id)
    if (failedWriteError) {
      // The exchange already rejected the order; if we also fail
      // to record the failure, surface that explicitly so the
      // operator knows the row is out of sync.
      return {
        ok: false,
        reason: `${result.reason} (failed to persist failure: ${failedWriteError.message})`,
      }
    }
    return { ok: false, reason: result.reason }
  }
  const { error: placedWriteError } = await service
    .from('live_signals')
    .update({
      status: 'order_placed',
      exchange_order_id: result.order_id,
      expires_at: expiresAt.toISOString(),
      cloid,
    })
    .eq('id', signal.id)
  if (placedWriteError) {
    // The exchange accepted the order but we could not record it.
    // The order is live with no row-level handle; the next
    // monitor tick will not find it. Surface as an outright
    // failure so the operator can manually cancel via the
    // Hyperliquid UI before it fills.
    return {
      ok: false,
      reason: `Order placed (id=${result.order_id}) but row write failed: ${placedWriteError.message}. Cancel manually on the exchange.`,
    }
  }
  return { ok: true }
}

// --- Order monitor tick -------------------------------------------

// Long position closes via a short stop / short tp; mirrored for
// short. The exchange interface uses the same OrderSide enum so
// we just flip it here.
function exitSide(entrySide: 'long' | 'short'): 'long' | 'short' {
  return entrySide === 'long' ? 'short' : 'long'
}

export type MonitorTickResult = {
  signals_inspected: number
  fills_recorded: number
  expirations: number
  closes_recorded: number
  errors: string[]
}

export async function runMonitorTick(
  service: Service,
  client: ExchangeClient,
): Promise<MonitorTickResult> {
  const out: MonitorTickResult = {
    signals_inspected: 0,
    fills_recorded: 0,
    expirations: 0,
    closes_recorded: 0,
    errors: [],
  }
  // 1. Order-placed signals: check for fills or expiry.
  const { data: placed, error: placedErr } = await service
    .from('live_signals')
    .select('*')
    .eq('status', 'order_placed')
  if (placedErr) {
    out.errors.push(`placed query: ${placedErr.message}`)
  } else {
    for (const signal of (placed ?? []) as LiveSignalRow[]) {
      out.signals_inspected += 1
      if (!signal.exchange_order_id) continue
      const status = await client.getOrderStatus(signal.exchange_order_id)
      if (status.kind === 'filled') {
        await onEntryFilled(service, client, signal, status.fill_price, status.filled_at)
        out.fills_recorded += 1
        continue
      }
      if (
        signal.expires_at &&
        new Date(signal.expires_at).getTime() <= Date.now()
      ) {
        await client.cancelOrder({
          order_id: signal.exchange_order_id,
          pair: signal.pair,
        })
        await service
          .from('live_signals')
          .update({
            status: 'expired_unfilled',
          })
          .eq('id', signal.id)
        out.expirations += 1
      }
    }
  }
  // 2. Filled signals: check for stop or target hits.
  const { data: filled, error: filledErr } = await service
    .from('live_signals')
    .select('*')
    .eq('status', 'filled')
  if (filledErr) {
    out.errors.push(`filled query: ${filledErr.message}`)
    return out
  }
  for (const signal of (filled ?? []) as LiveSignalRow[]) {
    out.signals_inspected += 1
    // Stop and target id may be the synthetic 'pending:*' string
    // we wrote when the placement returned 'waitingForTrigger'.
    // Resolve to a real numeric oid via cloid before reading
    // status. Writes the resolved oid back so subsequent ticks
    // skip the resolution step.
    const stopId = await maybeResolvePendingId(
      service,
      client,
      signal.id,
      signal.exchange_stop_order_id,
      signal.exchange_stop_cloid,
      'stop',
    )
    const tpId = await maybeResolvePendingId(
      service,
      client,
      signal.id,
      signal.exchange_target_order_id,
      signal.exchange_target_cloid,
      'target',
    )
    let closed = false
    if (stopId) {
      const stopStatus = await client.getOrderStatus(stopId)
      if (stopStatus.kind === 'filled') {
        await onPositionClosed(
          service,
          client,
          signal,
          stopStatus.fill_price,
          stopStatus.filled_at,
          'stop',
        )
        out.closes_recorded += 1
        closed = true
      } else if (stopStatus.kind === 'error') {
        out.errors.push(`stop status: ${stopStatus.message}`)
      }
    }
    if (closed) continue
    if (tpId) {
      const tpStatus = await client.getOrderStatus(tpId)
      if (tpStatus.kind === 'filled') {
        await onPositionClosed(
          service,
          client,
          signal,
          tpStatus.fill_price,
          tpStatus.filled_at,
          'target',
        )
        out.closes_recorded += 1
      } else if (tpStatus.kind === 'error') {
        out.errors.push(`target status: ${tpStatus.message}`)
      }
    }
  }
  return out
}

// When the persisted exchange_*_order_id starts with 'pending:'
// (synthetic placeholder for a trigger order that initially
// returned 'waitingForTrigger'), look it up by cloid in the
// open-orders feed. If we find a real oid, write it back to the
// row and return it; if the cloid is no longer in the open list
// the order may have already triggered+filled or been cancelled,
// in which case getOrderStatus(cloid) cannot help and we return
// the placeholder so the caller skips status work for this tick.
async function maybeResolvePendingId(
  service: Service,
  client: ExchangeClient,
  signalId: string,
  orderId: string | null,
  cloid: string | null,
  kind: 'stop' | 'target',
): Promise<string | null> {
  if (!orderId) return null
  if (!orderId.startsWith('pending:')) return orderId
  if (!cloid || !client.resolveOidByCloid) return orderId
  const oid = await client.resolveOidByCloid(cloid)
  if (oid === null) return orderId
  const realId = String(oid)
  const column =
    kind === 'stop' ? 'exchange_stop_order_id' : 'exchange_target_order_id'
  await service
    .from('live_signals')
    .update({ [column]: realId })
    .eq('id', signalId)
  return realId
}

async function onEntryFilled(
  service: Service,
  client: ExchangeClient,
  signal: LiveSignalRow,
  fillPrice: number,
  filledAt: Date,
): Promise<void> {
  // Place stop and target as separate conditional orders. The
  // mock client treats them as two open orders that fill on tick;
  // the real Hyperliquid client in Phase 2 may consolidate them
  // into a TP/SL combo, but the pipeline only cares that stop and
  // target both have unique exchange order ids.
  const stopRes = await client.placeStopLossOrder({
    client_order_id: clientOrderIdForSignal(signal.id, 'stop'),
    pair: signal.pair,
    side: exitSide(signal.direction),
    size_coin: Number(signal.intended_size_coin),
    trigger_price: Number(signal.intended_stop_price),
  })
  const tpRes = await client.placeTakeProfitOrder({
    client_order_id: clientOrderIdForSignal(signal.id, 'tp'),
    pair: signal.pair,
    side: exitSide(signal.direction),
    size_coin: Number(signal.intended_size_coin),
    trigger_price: Number(signal.intended_target_price),
  })
  // Persist cloids alongside the order ids so the monitor tick
  // can resolve a real oid later via openOrders.cloid lookup if
  // the placement initially returned 'waitingForTrigger'
  // (synthetic 'pending:*' order_id).
  await service
    .from('live_signals')
    .update({
      status: 'filled',
      filled_at: filledAt.toISOString(),
      fill_price: fillPrice,
      exchange_stop_order_id: stopRes.ok ? stopRes.order_id : null,
      exchange_target_order_id: tpRes.ok ? tpRes.order_id : null,
      exchange_stop_cloid: stopRes.ok ? (stopRes.cloid ?? null) : null,
      exchange_target_cloid: tpRes.ok ? (tpRes.cloid ?? null) : null,
      failure_reason:
        !stopRes.ok || !tpRes.ok
          ? `stop=${stopRes.ok ? 'ok' : stopRes.reason}, tp=${tpRes.ok ? 'ok' : tpRes.reason}`
          : null,
    })
    .eq('id', signal.id)
}

async function onPositionClosed(
  service: Service,
  client: ExchangeClient,
  signal: LiveSignalRow,
  exitPrice: number,
  closedAt: Date,
  reason: 'stop' | 'target',
): Promise<void> {
  // Cancel the surviving conditional order so it cannot trigger
  // a second close after we've already accounted for one side.
  const survivorId =
    reason === 'stop' ? signal.exchange_target_order_id : signal.exchange_stop_order_id
  if (survivorId) {
    await client.cancelOrder({ order_id: survivorId, pair: signal.pair })
  }
  const fillPrice = signal.fill_price == null ? Number(signal.intended_entry_price) : Number(signal.fill_price)
  const sizeCoin = Number(signal.intended_size_coin)
  const grossUsd =
    signal.direction === 'long'
      ? (exitPrice - fillPrice) * sizeCoin
      : (fillPrice - exitPrice) * sizeCoin
  // Phase 1 ignores fees; Phase 2 will pull the venue's actual
  // fill fee off the order receipt.
  const pnlUsd = grossUsd
  const pnlGbp = pnlUsd / GBP_USD_FALLBACK
  const riskGbp = Number(signal.intended_risk_gbp)
  const r = riskGbp > 0 ? pnlGbp / riskGbp : 0
  const status = reason === 'stop' ? 'closed_at_stop' : 'closed_at_target'

  // Auto-create a journal entry on the trades table so the live
  // result lands next to manually-entered trades automatically.
  const { data: trade, error: tradeErr } = await service
    .from('trades')
    .insert({
      tenant_id: signal.tenant_id,
      user_id: signal.user_id,
      asset_symbol: signal.pair,
      direction: signal.direction,
      entry_price: fillPrice,
      entry_size: sizeCoin,
      leverage: 1,
      venue: 'hyperliquid',
      narrative_tag: null,
      setup_type: 'live_deployment',
      thesis: `Live deployment ${signal.deployment_id}`,
      entry_at: signal.filled_at ?? signal.signal_at,
      exit_price: exitPrice,
      exit_size: sizeCoin,
      exit_at: closedAt.toISOString(),
      pnl: pnlGbp,
      outcome: pnlGbp > 0.01 ? 'win' : pnlGbp < -0.01 ? 'loss' : 'breakeven',
      lesson: null,
      source: 'hyperliquid',
      external_id: signal.exchange_order_id,
    })
    .select('id')
    .single()
  const journalTradeId = !tradeErr && trade ? trade.id : null
  await service
    .from('live_signals')
    .update({
      status,
      closed_at: closedAt.toISOString(),
      exit_price: exitPrice,
      exit_reason: reason,
      realised_pnl_gbp: pnlGbp,
      realised_r_multiple: r,
      journal_trade_id: journalTradeId,
    })
    .eq('id', signal.id)
}

// --- Kill switch --------------------------------------------------

// Used by /live's "Pause all live strategies" button. Cancels
// every open exchange order belonging to live deployments for the
// tenant, then transitions deployments live -> paused. Open
// signals get marked as cancelled so they no longer attempt to
// progress on the next monitor tick.
export async function pauseAllForTenant(
  service: Service,
  client: ExchangeClient,
  tenantId: string,
): Promise<{
  paused_deployments: number
  cancelled_orders: number
  cancelled_signals: number
}> {
  // Build the cloid whitelist from this tenant's in-flight
  // signals so the kill switch only cancels orders Dizzy placed.
  // Manual orders the operator opened directly on the Hyperliquid
  // UI stay untouched.
  const { data: openSignals } = await service
    .from('live_signals')
    .select('id, cloid, exchange_stop_cloid, exchange_target_cloid')
    .eq('tenant_id', tenantId)
    .in('status', [
      'pending_confirmation',
      'confirmed',
      'order_placed',
      'filled',
    ])
  const cloidWhitelist = new Set<string>()
  for (const row of (openSignals ?? []) as Array<{
    cloid: string | null
    exchange_stop_cloid: string | null
    exchange_target_cloid: string | null
  }>) {
    if (row.cloid) cloidWhitelist.add(row.cloid)
    if (row.exchange_stop_cloid) cloidWhitelist.add(row.exchange_stop_cloid)
    if (row.exchange_target_cloid) cloidWhitelist.add(row.exchange_target_cloid)
  }
  const cancelled = await client.cancelAllOrders({
    cloid_whitelist: cloidWhitelist.size > 0 ? cloidWhitelist : undefined,
  })
  const cancelledOrderCount = cancelled.cancelled_order_ids.length
  const cancelledSignalCount = (openSignals ?? []).length
  if (cancelledSignalCount > 0) {
    await service
      .from('live_signals')
      .update({
        status: 'cancelled',
        failure_reason: 'kill switch',
      })
      .eq('tenant_id', tenantId)
      .in('status', [
        'pending_confirmation',
        'confirmed',
        'order_placed',
        'filled',
      ])
  }

  // Pause every live deployment. Archived deployments are left
  // alone; the operator can re-deploy individually after.
  const { data: deployments } = await service
    .from('strategy_deployments')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'live')
  const deploymentCount = (deployments ?? []).length
  if (deploymentCount > 0) {
    await service
      .from('strategy_deployments')
      .update({
        status: 'paused',
        paused_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('status', 'live')
  }

  return {
    paused_deployments: deploymentCount,
    cancelled_orders: cancelledOrderCount,
    cancelled_signals: cancelledSignalCount,
  }
}
