// Mock Hyperliquid exchange client used during Phase 1 of the live
// deployment rollout. Stores orders in a process-local map and
// simulates fills based on a price stream the test harness pushes
// in via pushTick. This is intentionally simple: it lets the live
// pipeline exercise its full state machine end-to-end without
// touching a real venue.
//
// Phase 2 swaps this for a real Hyperliquid client behind the same
// ExchangeClient interface (see ./factory.ts). Nothing in the
// pipeline depends on this file directly.

import type {
  CancelAllInput,
  CancelAllResult,
  CancelOrderInput,
  CancelResult,
  ExchangeClient,
  MockAuditEvent,
  MockExchangeClient,
  MockMarketTick,
  OrderResult,
  OrderStatus,
  PlaceLimitOrderInput,
  PlaceStopOrderInput,
  PlaceTpOrderInput,
  Position,
  AccountState,
} from './types'

type StoredOrder = {
  order_id: string
  client_order_id: string
  kind: 'limit' | 'stop' | 'tp'
  pair: string
  side: 'long' | 'short'
  size_coin: number
  // For limits: the limit price. For stops/tp: the trigger.
  price: number
  state: 'open' | 'filled' | 'cancelled'
  fill_price?: number
  filled_at?: Date
  cancelled_at?: Date
  expires_at?: Date
  placed_at: Date
}

export class MockHyperliquidClient implements MockExchangeClient {
  private orders = new Map<string, StoredOrder>()
  private byClientId = new Map<string, string>()
  private audit: MockAuditEvent[] = []
  private nextSeq = 1

  // Latest known price per pair. Updated by pushTick; used to
  // simulate fills and stop / target hits. Defaults to undefined
  // until a tick arrives, in which case orders only fill when the
  // operator force-fills them.
  private lastTickByPair = new Map<string, MockMarketTick>()

  // Phase-1 fill rate. Limits whose limit_price would have filled
  // on the next tick are skipped this fraction of the time so the
  // pipeline gets to exercise the "expired_unfilled" path too.
  private fillRate = 0.7

  setFillRate(rate: number): void {
    this.fillRate = Math.max(0, Math.min(1, rate))
  }

  private mintOrderId(): string {
    const id = `mock-${this.nextSeq.toString().padStart(6, '0')}`
    this.nextSeq += 1
    return id
  }

  private record(event: Omit<MockAuditEvent, 'at'>): void {
    this.audit.push({ ...event, at: new Date() })
  }

  drainAuditLog(): MockAuditEvent[] {
    const copy = [...this.audit]
    this.audit = []
    return copy
  }

  // --- ExchangeClient surface ------------------------------------

  async placeLimitOrder(input: PlaceLimitOrderInput): Promise<OrderResult> {
    // Idempotency on client_order_id: a replay should return the
    // existing order, not double-place.
    const existingId = this.byClientId.get(input.client_order_id)
    if (existingId) {
      const existing = this.orders.get(existingId)
      if (existing) {
        return { ok: true, order_id: existing.order_id, placed_at: existing.placed_at }
      }
    }
    const order_id = this.mintOrderId()
    const order: StoredOrder = {
      order_id,
      client_order_id: input.client_order_id,
      kind: 'limit',
      pair: input.pair,
      side: input.side,
      size_coin: input.size_coin,
      price: input.limit_price,
      state: 'open',
      expires_at: input.expires_at,
      placed_at: new Date(),
    }
    this.orders.set(order_id, order)
    this.byClientId.set(input.client_order_id, order_id)
    this.record({
      kind: 'limit_placed',
      order_id,
      pair: input.pair,
      detail: `${input.side} ${input.size_coin} @ ${input.limit_price} (expires ${input.expires_at.toISOString()})`,
    })
    // If a tick has already crossed the limit price by the time
    // the order lands, fill immediately - matches how a real
    // exchange behaves for marketable limits.
    this.maybeFillFromTick(order)
    return { ok: true, order_id, placed_at: order.placed_at }
  }

  async placeStopLossOrder(input: PlaceStopOrderInput): Promise<OrderResult> {
    const existingId = this.byClientId.get(input.client_order_id)
    if (existingId) {
      const existing = this.orders.get(existingId)
      if (existing) {
        return { ok: true, order_id: existing.order_id, placed_at: existing.placed_at }
      }
    }
    const order_id = this.mintOrderId()
    const order: StoredOrder = {
      order_id,
      client_order_id: input.client_order_id,
      kind: 'stop',
      pair: input.pair,
      side: input.side,
      size_coin: input.size_coin,
      price: input.trigger_price,
      state: 'open',
      placed_at: new Date(),
    }
    this.orders.set(order_id, order)
    this.byClientId.set(input.client_order_id, order_id)
    this.record({
      kind: 'stop_placed',
      order_id,
      pair: input.pair,
      detail: `${input.side} ${input.size_coin} stop @ ${input.trigger_price}`,
    })
    return { ok: true, order_id, placed_at: order.placed_at }
  }

  async placeTakeProfitOrder(input: PlaceTpOrderInput): Promise<OrderResult> {
    const existingId = this.byClientId.get(input.client_order_id)
    if (existingId) {
      const existing = this.orders.get(existingId)
      if (existing) {
        return { ok: true, order_id: existing.order_id, placed_at: existing.placed_at }
      }
    }
    const order_id = this.mintOrderId()
    const order: StoredOrder = {
      order_id,
      client_order_id: input.client_order_id,
      kind: 'tp',
      pair: input.pair,
      side: input.side,
      size_coin: input.size_coin,
      price: input.trigger_price,
      state: 'open',
      placed_at: new Date(),
    }
    this.orders.set(order_id, order)
    this.byClientId.set(input.client_order_id, order_id)
    this.record({
      kind: 'tp_placed',
      order_id,
      pair: input.pair,
      detail: `${input.side} ${input.size_coin} tp @ ${input.trigger_price}`,
    })
    return { ok: true, order_id, placed_at: order.placed_at }
  }

  async cancelOrder(input: CancelOrderInput): Promise<CancelResult> {
    const order = this.orders.get(input.order_id)
    if (!order) return { ok: false, reason: 'unknown order_id' }
    if (order.state !== 'open') {
      return { ok: false, reason: `order is ${order.state}` }
    }
    order.state = 'cancelled'
    order.cancelled_at = new Date()
    this.record({
      kind: 'limit_cancelled',
      order_id: order.order_id,
      pair: order.pair,
      detail: 'cancelled by pipeline',
    })
    return { ok: true, cancelled_at: order.cancelled_at }
  }

  async cancelAllOrders(input: CancelAllInput): Promise<CancelAllResult> {
    const cancelled: string[] = []
    for (const order of this.orders.values()) {
      if (order.state !== 'open') continue
      if (input.pair && order.pair !== input.pair) continue
      order.state = 'cancelled'
      order.cancelled_at = new Date()
      cancelled.push(order.order_id)
    }
    this.record({
      kind: 'cancel_all',
      pair: input.pair ?? '*',
      detail: `cancelled ${cancelled.length} order(s)`,
    })
    return { ok: true, cancelled_order_ids: cancelled }
  }

  async getOrderStatus(order_id: string): Promise<OrderStatus> {
    const order = this.orders.get(order_id)
    if (!order) return { kind: 'unknown', order_id }
    if (order.state === 'cancelled') {
      return {
        kind: 'cancelled',
        order_id,
        cancelled_at: order.cancelled_at!,
      }
    }
    if (order.state === 'filled') {
      return {
        kind: 'filled',
        order_id,
        fill_price: order.fill_price!,
        filled_at: order.filled_at!,
      }
    }
    return {
      kind: 'open',
      order_id,
      remaining_size: order.size_coin,
    }
  }

  async getOpenPositions(): Promise<Position[]> {
    // Phase 1 does not synthesise position rows from filled
    // orders; the live_signals table is the source of truth for
    // "what is open". This stub returns an empty list so callers
    // can still hit the method without special-casing the mock.
    return []
  }

  async getAccountState(): Promise<AccountState> {
    let openOrders = 0
    for (const order of this.orders.values()) {
      if (order.state === 'open') openOrders += 1
    }
    return {
      balance_usd: 10_000,
      positions: [],
      open_order_count: openOrders,
    }
  }

  // --- Mock-only surface -----------------------------------------

  pushTick(tick: MockMarketTick): void {
    this.lastTickByPair.set(tick.pair, tick)
    for (const order of this.orders.values()) {
      if (order.pair !== tick.pair) continue
      if (order.state !== 'open') continue
      this.maybeFillFromTick(order, tick)
    }
  }

  forceFillOpenLimit(order_id: string, fill_price: number): void {
    const order = this.orders.get(order_id)
    if (!order || order.state !== 'open' || order.kind !== 'limit') return
    order.state = 'filled'
    order.fill_price = fill_price
    order.filled_at = new Date()
    this.record({
      kind: 'force_action',
      order_id,
      pair: order.pair,
      detail: `force-filled limit at ${fill_price}`,
    })
  }

  forceTriggerStop(order_id: string, trigger_price: number): void {
    const order = this.orders.get(order_id)
    if (!order || order.state !== 'open' || order.kind !== 'stop') return
    order.state = 'filled'
    order.fill_price = trigger_price
    order.filled_at = new Date()
    this.record({
      kind: 'stop_triggered',
      order_id,
      pair: order.pair,
      detail: `stop triggered at ${trigger_price}`,
    })
  }

  forceTriggerTakeProfit(order_id: string, trigger_price: number): void {
    const order = this.orders.get(order_id)
    if (!order || order.state !== 'open' || order.kind !== 'tp') return
    order.state = 'filled'
    order.fill_price = trigger_price
    order.filled_at = new Date()
    this.record({
      kind: 'tp_triggered',
      order_id,
      pair: order.pair,
      detail: `tp triggered at ${trigger_price}`,
    })
  }

  private maybeFillFromTick(order: StoredOrder, tick?: MockMarketTick): void {
    const t = tick ?? this.lastTickByPair.get(order.pair)
    if (!t) return
    // Limit fills: long limit fills if the bar's low <= limit;
    // short limit fills if the bar's high >= limit. Apply the
    // fill rate as a simple gate so some orders deliberately
    // miss to exercise the expired path.
    if (order.kind === 'limit') {
      const wouldFill =
        order.side === 'long' ? t.low <= order.price : t.high >= order.price
      if (!wouldFill) return
      if (Math.random() > this.fillRate) return
      order.state = 'filled'
      order.fill_price = order.price
      order.filled_at = new Date()
      this.record({
        kind: 'limit_filled',
        order_id: order.order_id,
        pair: order.pair,
        detail: `filled at ${order.price}`,
      })
      return
    }
    // Stops: long position's stop hits when low <= trigger (we
    // are short to close); short position's stop hits when high
    // >= trigger.
    if (order.kind === 'stop') {
      const wouldHit =
        order.side === 'short' ? t.low <= order.price : t.high >= order.price
      if (!wouldHit) return
      order.state = 'filled'
      order.fill_price = order.price
      order.filled_at = new Date()
      this.record({
        kind: 'stop_triggered',
        order_id: order.order_id,
        pair: order.pair,
        detail: `triggered at ${order.price}`,
      })
      return
    }
    // Take-profit mirrors stop logic on the opposite side of the
    // entry.
    if (order.kind === 'tp') {
      const wouldHit =
        order.side === 'short' ? t.high >= order.price : t.low <= order.price
      if (!wouldHit) return
      order.state = 'filled'
      order.fill_price = order.price
      order.filled_at = new Date()
      this.record({
        kind: 'tp_triggered',
        order_id: order.order_id,
        pair: order.pair,
        detail: `triggered at ${order.price}`,
      })
    }
  }
}

// Module-scoped singleton so the same in-memory state is visible
// across server actions, the monitor tick, and the /live page.
// In a multi-instance Vercel deployment each lambda gets its own
// copy; this is fine because Phase 1 is local-dev / single-region
// only - Phase 2 ships the real client which talks to Hyperliquid
// directly and has no in-memory state.
let singleton: MockHyperliquidClient | null = null

export function getMockHyperliquidClient(): MockHyperliquidClient {
  if (!singleton) singleton = new MockHyperliquidClient()
  return singleton
}

// Test-only: lets unit tests start with a fresh client.
export function __resetMockHyperliquidClient(): void {
  singleton = new MockHyperliquidClient()
}

// Type re-export so callers that only need the mock surface can
// import it without pulling in everything from ./types.
export type { ExchangeClient }
