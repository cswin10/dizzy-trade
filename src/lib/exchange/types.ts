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
  // Hyperliquid actively reports the order does not exist on the
  // exchange. Distinct from 'error' so the monitor tick can move
  // the signal to a terminal state instead of polling forever.
  | { kind: 'unknown'; order_id: string }
  // Network / SDK / unexpected error fetching the status. Caller
  // should log and continue rather than treating the order as
  // open or unknown.
  | { kind: 'error'; order_id: string; message: string }

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
  // Optional whitelist of client order ids to cancel. When set,
  // the client only cancels orders whose cloid appears in the
  // list, leaving manual orders on the master account untouched.
  // Used by the kill switch and the per-deployment pause path so
  // pulling the trigger on Dizzy does not also cancel orders the
  // user placed by hand on the Hyperliquid UI.
  cloid_whitelist?: ReadonlySet<string>
}

export type OrderResult =
  | {
      ok: true
      order_id: string
      placed_at: Date
      // Hyperliquid trigger orders sometimes return
      // 'waitingForTrigger' instead of an oid. The client
      // synthesises an order_id like 'pending:stop:<ts>' in that
      // case and surfaces this flag so the caller (the pipeline)
      // knows to persist the cloid alongside, and the monitor
      // tick knows to resolve a real oid via cloid before reading
      // status. Always-false / undefined for non-synthetic results.
      cloid_only?: true
      cloid?: string
    }
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

// Hyperliquid account abstraction modes. Drives where balance is
// read from: 'default' / 'disabled' use the perp clearinghouse;
// 'unifiedAccount' / 'portfolioMargin' use the spot clearinghouse
// (USDC entry); 'dexAbstraction' is HIP-3 and currently treated
// as 'default' until we have a real account in that mode.
// 'mock' is the synthetic value the mock client returns so the
// pipeline does not have to special-case it.
export type AccountAbstractionMode =
  | 'default'
  | 'disabled'
  | 'unifiedAccount'
  | 'portfolioMargin'
  | 'dexAbstraction'
  | 'mock'

export type AccountState = {
  balance_usd: number
  positions: Position[]
  open_order_count: number
  abstraction_mode: AccountAbstractionMode
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
  // Resolves a cloid to a numeric oid by walking the master
  // account's open-orders feed. Returns null when the cloid is
  // not in the open list (could mean it triggered + filled, or
  // was cancelled, or never placed). Optional on the interface
  // because the mock client returns null and the live caller
  // only invokes it when an exchange_*_order_id starts with
  // 'pending:'.
  resolveOidByCloid?(cloid: string): Promise<number | null>
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
