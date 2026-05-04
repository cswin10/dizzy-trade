// Exchange-agnostic types. The live pipeline talks to whichever
// exchange client the factory hands back through this surface.
// Phase 1 ships a mock implementation; Phase 2 swaps in real
// Hyperliquid against the same interface, no pipeline changes.
//
// Conventions:
//   - Sizes are in coin units. The pipeline computes coin from
//     GBP risk before calling the client.
//   - Prices are in USD (the exchange's quote currency).
//   - All methods are idempotent on client_order_id: replaying a
//     placeLimitOrder with an existing id is a no-op that returns
//     the prior result.

export type OrderSide = 'long' | 'short'

export type OrderStatus =
  | { kind: 'open'; order_id: string; remaining_size: number }
  | { kind: 'filled'; order_id: string; fill_price: number; filled_at: Date }
  | { kind: 'cancelled'; order_id: string; cancelled_at: Date }
  | { kind: 'unknown'; order_id: string }

export type PlaceLimitOrderInput = {
  client_order_id: string
  pair: string
  side: OrderSide
  size_coin: number
  limit_price: number
  // Phase 1 stores expiry locally on the live_signals row; the
  // mock client does not enforce GTD.
  expires_at: Date
}

export type PlaceStopOrderInput = {
  client_order_id: string
  pair: string
  // The side that will close the position on stop. Mirror of the
  // entry side (long entry -> short stop).
  side: OrderSide
  size_coin: number
  trigger_price: number
}

export type PlaceTpOrderInput = {
  client_order_id: string
  pair: string
  side: OrderSide
  size_coin: number
  trigger_price: number
}

export type CancelOrderInput = {
  order_id: string
  pair: string
}

export type CancelAllInput = {
  pair?: string
}

export type OrderResult =
  | { ok: true; order_id: string; placed_at: Date }
  | { ok: false; reason: string }

export type CancelResult =
  | { ok: true; cancelled_at: Date }
  | { ok: false; reason: string }

export type CancelAllResult = {
  ok: true
  cancelled_order_ids: string[]
}

export type Position = {
  pair: string
  side: OrderSide
  size_coin: number
  entry_price: number
  unrealised_pnl_usd: number
}

export type AccountState = {
  balance_usd: number
  positions: Position[]
  open_order_count: number
}

// Inputs the pipeline gives the mock client so it can simulate
// fills against a known price stream. Production exchange clients
// ignore this; only the mock cares.
export type MockMarketTick = {
  pair: string
  price: number
  high: number
  low: number
  at: Date
}

export interface ExchangeClient {
  placeLimitOrder(input: PlaceLimitOrderInput): Promise<OrderResult>
  placeStopLossOrder(input: PlaceStopOrderInput): Promise<OrderResult>
  placeTakeProfitOrder(input: PlaceTpOrderInput): Promise<OrderResult>
  cancelOrder(input: CancelOrderInput): Promise<CancelResult>
  cancelAllOrders(input: CancelAllInput): Promise<CancelAllResult>
  getOrderStatus(order_id: string): Promise<OrderStatus>
  getOpenPositions(): Promise<Position[]>
  getAccountState(): Promise<AccountState>
}

// Phase 1 mock-only extension. Lets test code (and the /live page's
// "advance price" debug button) feed synthetic ticks into the mock
// without touching the real ExchangeClient interface.
export interface MockExchangeClient extends ExchangeClient {
  pushTick(tick: MockMarketTick): void
  // Force-fill any open limit at its limit price; used by the
  // "Manually advance the mock client" acceptance step.
  forceFillOpenLimit(order_id: string, fill_price: number): void
  // Force-trigger a stop or take-profit order so the operator can
  // step through the close path without waiting for a tick.
  forceTriggerStop(order_id: string, trigger_price: number): void
  forceTriggerTakeProfit(order_id: string, trigger_price: number): void
  // Snapshot of every action the client has been asked to perform.
  // Surfaced on the /live page so the operator can see exactly what
  // would have hit the real exchange.
  drainAuditLog(): MockAuditEvent[]
}

export type MockAuditEvent = {
  at: Date
  kind:
    | 'limit_placed'
    | 'limit_filled'
    | 'limit_cancelled'
    | 'stop_placed'
    | 'stop_triggered'
    | 'tp_placed'
    | 'tp_triggered'
    | 'cancel_all'
    | 'force_action'
  order_id?: string
  pair: string
  detail: string
}
