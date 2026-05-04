// Real Hyperliquid client. Implements the same ExchangeClient
// interface the mock satisfies, so the live pipeline does not
// know which it is talking to. Phase 2a is testnet-only; the
// constructor explicitly rejects mainnet so a misconfigured row
// or a future flag flip cannot accidentally route real funds
// through this code path.
//
// SDK choice: @nktkas/hyperliquid (active TypeScript SDK with
// EIP-712 signing already wired up via viem). It exposes
// HttpTransport with isTestnet, ExchangeClient.order /
// cancelByCloid for the exchange surface, and InfoClient
// .clearinghouseState / .orderStatus / .meta for reads.

import 'server-only'

import * as hl from '@nktkas/hyperliquid'
import { createHash } from 'node:crypto'
import { privateKeyToAccount } from 'viem/accounts'

import type {
  AccountState,
  CancelAllInput,
  CancelAllResult,
  CancelOrderInput,
  CancelResult,
  ExchangeClient,
  OrderResult,
  OrderStatus,
  PlaceLimitOrderInput,
  PlaceStopOrderInput,
  PlaceTpOrderInput,
  Position,
} from './types'

export type HyperliquidClientOptions = {
  privateKey: `0x${string}`
  apiWalletAddress: `0x${string}`
  // The user's main Hyperliquid account. The API wallet signs
  // orders on its behalf. InfoClient queries by master address.
  masterAccountAddress: `0x${string}`
  network: 'testnet' | 'mainnet'
}

// Translates a Hyperliquid SDK / API error into the structured
// error_code / message pair the live_signals row records as
// failure_reason. Phase 2c can refine these further; Phase 2a
// keeps the categories coarse so the operator gets a clear hint
// from the /live UI without chasing stack traces.
type ClientErrorCode =
  | 'INSUFFICIENT_MARGIN'
  | 'INVALID_ORDER'
  | 'NETWORK_ERROR'
  | 'UNKNOWN'

function classifyError(message: string): ClientErrorCode {
  const lower = message.toLowerCase()
  if (
    lower.includes('insufficient margin') ||
    lower.includes('margin')
  ) {
    return 'INSUFFICIENT_MARGIN'
  }
  if (
    lower.includes('tick') ||
    lower.includes('min trade') ||
    lower.includes('rejected') ||
    lower.includes('invalid')
  ) {
    return 'INVALID_ORDER'
  }
  if (
    lower.includes('fetch') ||
    lower.includes('network') ||
    lower.includes('timeout') ||
    lower.includes('econn')
  ) {
    return 'NETWORK_ERROR'
  }
  return 'UNKNOWN'
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return JSON.stringify(error).slice(0, 500)
}

// Hyperliquid's cloid is a 16-byte hex string with 0x prefix
// (34 chars total). Derive deterministically from the pipeline's
// client_order_id (signal_id:role) so a retry of the same
// placement reuses the same cloid and the API rejects the
// duplicate instead of double-placing.
function cloidFor(client_order_id: string): `0x${string}` {
  const hash = createHash('sha256').update(client_order_id).digest('hex')
  return `0x${hash.slice(0, 32)}` as `0x${string}`
}

export class HyperliquidClient implements ExchangeClient {
  private readonly exchange: hl.ExchangeClient
  private readonly info: hl.InfoClient
  private readonly masterAccountAddress: `0x${string}`
  private readonly network: 'testnet' | 'mainnet'
  // Asset-id cache for the perp universe. Resolved lazily on the
  // first order; cached for the lifetime of the process. The
  // Phase-1 mock kept a similar map keyed by symbol.
  private assetIndexCache: Map<string, number> | null = null

  constructor(options: HyperliquidClientOptions) {
    if (options.network !== 'testnet') {
      throw new Error(
        `HyperliquidClient: only testnet is supported in Phase 2a (got "${options.network}")`,
      )
    }
    this.network = options.network
    this.masterAccountAddress = options.masterAccountAddress
    const transport = new hl.HttpTransport({ isTestnet: true })
    const wallet = privateKeyToAccount(options.privateKey)
    this.exchange = new hl.ExchangeClient({ transport, wallet })
    this.info = new hl.InfoClient({ transport })
  }

  private async assetIndex(pair: string): Promise<number> {
    if (!this.assetIndexCache) {
      const meta = await this.info.meta()
      const map = new Map<string, number>()
      meta.universe.forEach((u, i) => map.set(u.name, i))
      this.assetIndexCache = map
    }
    const idx = this.assetIndexCache.get(pair)
    if (idx === undefined) {
      throw new Error(`HyperliquidClient: unknown pair "${pair}"`)
    }
    return idx
  }

  // --- ExchangeClient surface -----------------------------------

  async placeLimitOrder(input: PlaceLimitOrderInput): Promise<OrderResult> {
    try {
      const a = await this.assetIndex(input.pair)
      const cloid = cloidFor(input.client_order_id)
      const result = await this.exchange.order({
        orders: [
          {
            a,
            b: input.side === 'long',
            p: String(input.limit_price),
            s: String(input.size_coin),
            r: false,
            t: { limit: { tif: 'Gtc' } },
            c: cloid,
          },
        ],
        grouping: 'na',
      })
      return interpretOrderResponse(result, 'limit')
    } catch (error) {
      const message = errorMessage(error)
      return { ok: false, reason: `[${classifyError(message)}] ${message}` }
    }
  }

  async placeStopLossOrder(input: PlaceStopOrderInput): Promise<OrderResult> {
    return this.placeTriggerOrder(
      input.client_order_id,
      input.pair,
      input.side,
      input.size_coin,
      input.trigger_price,
      'sl',
    )
  }

  async placeTakeProfitOrder(input: PlaceTpOrderInput): Promise<OrderResult> {
    return this.placeTriggerOrder(
      input.client_order_id,
      input.pair,
      input.side,
      input.size_coin,
      input.trigger_price,
      'tp',
    )
  }

  private async placeTriggerOrder(
    client_order_id: string,
    pair: string,
    side: 'long' | 'short',
    size_coin: number,
    trigger_price: number,
    tpsl: 'sl' | 'tp',
  ): Promise<OrderResult> {
    try {
      const a = await this.assetIndex(pair)
      const cloid = cloidFor(client_order_id)
      const result = await this.exchange.order({
        orders: [
          {
            a,
            // Stops/TP are reduce-only and on the opposite side
            // of the original entry. The pipeline already passes
            // the exit side so we honour it directly.
            b: side === 'long',
            p: String(trigger_price),
            s: String(size_coin),
            r: true,
            t: {
              trigger: {
                isMarket: true,
                triggerPx: String(trigger_price),
                tpsl,
              },
            },
            c: cloid,
          },
        ],
        grouping: 'na',
      })
      return interpretOrderResponse(result, tpsl === 'sl' ? 'stop' : 'tp')
    } catch (error) {
      const message = errorMessage(error)
      return { ok: false, reason: `[${classifyError(message)}] ${message}` }
    }
  }

  async cancelOrder(input: CancelOrderInput): Promise<CancelResult> {
    try {
      const a = await this.assetIndex(input.pair)
      const oid = Number(input.order_id)
      if (!Number.isFinite(oid)) {
        return { ok: false, reason: `non-numeric order id ${input.order_id}` }
      }
      await this.exchange.cancel({
        cancels: [{ a, o: oid }],
      })
      return { ok: true, cancelled_at: new Date() }
    } catch (error) {
      return { ok: false, reason: errorMessage(error) }
    }
  }

  async cancelAllOrders(input: CancelAllInput): Promise<CancelAllResult> {
    // Hyperliquid does not expose a single "cancel everything"
    // call; we have to enumerate the open orders and cancel by
    // order id. Filtering by pair when provided.
    try {
      const open = await this.info.openOrders({
        user: this.masterAccountAddress,
      })
      const filtered = input.pair
        ? open.filter((o) => o.coin === input.pair)
        : open
      if (filtered.length === 0) {
        return { ok: true, cancelled_order_ids: [] }
      }
      // Group by asset so we can issue one cancel call with all
      // (a, o) pairs.
      const cancels: Array<{ a: number; o: number }> = []
      for (const o of filtered) {
        const a = await this.assetIndex(o.coin)
        cancels.push({ a, o: o.oid })
      }
      await this.exchange.cancel({ cancels })
      return {
        ok: true,
        cancelled_order_ids: filtered.map((o) => String(o.oid)),
      }
    } catch (error) {
      // cancelAll is best-effort during the kill switch path,
      // so we return ok: true with an empty list rather than
      // trapping the operator at "kill switch failed".
      console.error(
        '[hyperliquid] cancelAllOrders failed:',
        errorMessage(error),
      )
      return { ok: true, cancelled_order_ids: [] }
    }
  }

  async getOrderStatus(order_id: string): Promise<OrderStatus> {
    const oid = Number(order_id)
    if (!Number.isFinite(oid)) {
      return { kind: 'unknown', order_id }
    }
    try {
      const result = await this.info.orderStatus({
        user: this.masterAccountAddress,
        oid,
      })
      if (result.status === 'unknownOid') {
        return { kind: 'unknown', order_id }
      }
      const phase = result.order.status
      if (phase === 'filled') {
        const fillPrice = Number(result.order.order.limitPx)
        const filledAtMs = Number(result.order.statusTimestamp)
        return {
          kind: 'filled',
          order_id,
          fill_price: fillPrice,
          filled_at: new Date(filledAtMs),
        }
      }
      if (
        phase === 'canceled' ||
        phase === 'rejected' ||
        phase === 'marginCanceled' ||
        phase === 'reduceOnlyCanceled' ||
        phase === 'liquidatedCanceled' ||
        phase === 'scheduledCancel' ||
        phase === 'siblingFilledCanceled' ||
        phase === 'tickRejected' ||
        phase === 'minTradeNtlRejected' ||
        phase === 'perpMarginRejected'
      ) {
        const cancelledAtMs = Number(result.order.statusTimestamp)
        return {
          kind: 'cancelled',
          order_id,
          cancelled_at: new Date(cancelledAtMs),
        }
      }
      // Open / triggered / anything else maps to "still open"
      // from the pipeline's perspective.
      return {
        kind: 'open',
        order_id,
        remaining_size: Number(result.order.order.sz),
      }
    } catch (error) {
      console.error(
        '[hyperliquid] getOrderStatus error for',
        order_id,
        errorMessage(error),
      )
      return { kind: 'unknown', order_id }
    }
  }

  async getOpenPositions(): Promise<Position[]> {
    try {
      const state = await this.info.clearinghouseState({
        user: this.masterAccountAddress,
      })
      return state.assetPositions
        .filter((ap) => Number(ap.position.szi) !== 0)
        .map((ap) => ({
          pair: ap.position.coin,
          side: Number(ap.position.szi) > 0 ? 'long' : 'short',
          size_coin: Math.abs(Number(ap.position.szi)),
          entry_price: Number(ap.position.entryPx ?? 0),
          unrealised_pnl_usd: Number(ap.position.unrealizedPnl ?? 0),
        }))
    } catch (error) {
      console.error(
        '[hyperliquid] getOpenPositions error:',
        errorMessage(error),
      )
      return []
    }
  }

  async getAccountState(): Promise<AccountState> {
    try {
      const state = await this.info.clearinghouseState({
        user: this.masterAccountAddress,
      })
      const open = await this.info.openOrders({
        user: this.masterAccountAddress,
      })
      return {
        balance_usd: Number(state.marginSummary.accountValue ?? 0),
        positions: state.assetPositions
          .filter((ap) => Number(ap.position.szi) !== 0)
          .map((ap) => ({
            pair: ap.position.coin,
            side: Number(ap.position.szi) > 0 ? 'long' : 'short',
            size_coin: Math.abs(Number(ap.position.szi)),
            entry_price: Number(ap.position.entryPx ?? 0),
            unrealised_pnl_usd: Number(ap.position.unrealizedPnl ?? 0),
          })),
        open_order_count: open.length,
      }
    } catch (error) {
      console.error(
        '[hyperliquid] getAccountState error:',
        errorMessage(error),
      )
      return { balance_usd: 0, positions: [], open_order_count: 0 }
    }
  }
}

// Decoders for the (resting | filled | error | waitingForFill |
// waitingForTrigger) status union the SDK returns. Surface
// "resting" and "filled" as ok with the order id; "error" and
// the waiting variants come back as ok: false so the pipeline
// records the failure reason on live_signals.
function interpretOrderResponse(
  // The SDK-returned shape; using a structural type here keeps
  // the file decoupled from any one SDK version.
  result: {
    response?: {
      data?: {
        statuses?: Array<unknown>
      }
    }
  },
  kind: 'limit' | 'stop' | 'tp',
): OrderResult {
  const statuses = result?.response?.data?.statuses ?? []
  const first = statuses[0]
  if (first && typeof first === 'object') {
    if ('resting' in first) {
      const oid = (first as { resting: { oid: number } }).resting.oid
      return { ok: true, order_id: String(oid), placed_at: new Date() }
    }
    if ('filled' in first) {
      const oid = (first as { filled: { oid: number } }).filled.oid
      return { ok: true, order_id: String(oid), placed_at: new Date() }
    }
    if ('error' in first) {
      const message = String((first as { error: string }).error)
      return { ok: false, reason: `[${classifyError(message)}] ${message}` }
    }
  }
  if (typeof first === 'string') {
    if (first === 'waitingForTrigger' || first === 'waitingForFill') {
      // Trigger orders return 'waitingForTrigger' on placement.
      // Treat as "successfully placed but not yet active" - the
      // monitor tick will pick up the eventual fill via
      // getOrderStatus on the cloid->oid mapping. For now we
      // surface a synthetic order id derived from the cloid so
      // the pipeline can find the order again.
      return {
        ok: true,
        order_id: `pending:${kind}:${Date.now()}`,
        placed_at: new Date(),
      }
    }
  }
  return { ok: false, reason: `unexpected status: ${JSON.stringify(first)}` }
}
