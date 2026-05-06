// Real Hyperliquid client. Implements the same ExchangeClient
// interface the mock satisfies, so the live pipeline does not
// know which it is talking to. Phase 2b widens the previous
// testnet-only constraint to support mainnet too. Mainnet is
// only reached when:
//   1. exchange_credentials.network === 'mainnet'
//   2. the factory's ALLOWED_NETWORKS includes 'mainnet'
//   3. the user ticked the mainnet-consent checkbox in the
//      settings form (server action validates this)
//   4. the hardcoded safety caps in src/lib/live/safety-limits.ts
//      passed the size and risk for this specific signal.
// All four must be true. The HttpTransport is built from the
// credentials row's network; nothing else picks the URL.
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
  AccountAbstractionMode,
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
  // Account abstraction mode. Hyperliquid's default for new
  // accounts is 'unifiedAccount', which means the perp
  // clearinghouseState response shows zero balance even when the
  // account holds USDC; the funds live on the spot side. Cached
  // after the first lookup; getAccountState branches on it.
  private abstractionMode: AccountAbstractionMode | null = null

  constructor(options: HyperliquidClientOptions) {
    if (options.network !== 'testnet' && options.network !== 'mainnet') {
      // Anything other than the two known networks is rejected
      // outright. Phase 2c reserved this slot for future expansion
      // (e.g. a regional endpoint); for now the union is closed.
      throw new Error(
        `HyperliquidClient: unsupported network "${options.network}"`,
      )
    }
    this.network = options.network
    this.masterAccountAddress = options.masterAccountAddress
    // The transport's isTestnet flag is the single source of truth
    // for which Hyperliquid host the SDK talks to. It comes from
    // the credentials row, not from a default, not from an env
    // var, not from a feature flag.
    const transport = new hl.HttpTransport({
      isTestnet: options.network === 'testnet',
    })
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
      return interpretOrderResponse(result, 'limit', cloid)
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
      return interpretOrderResponse(result, tpsl === 'sl' ? 'stop' : 'tp', cloid)
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
      const message = errorMessage(error)
      console.error(
        '[hyperliquid] getOrderStatus error for',
        order_id,
        message,
      )
      return { kind: 'error', order_id, message }
    }
  }

  // Resolves a cloid to its real numeric oid by walking the
  // master account's open-orders feed. Used by the monitor tick
  // when a previous trigger placement returned 'waitingForTrigger'
  // (no oid yet) and we still hold only the cloid. Returns null
  // when the order is not in the open-orders list (could mean it
  // already triggered and filled, was cancelled, or never placed).
  async resolveOidByCloid(cloid: string): Promise<number | null> {
    try {
      const open = await this.info.openOrders({
        user: this.masterAccountAddress,
      })
      const match = open.find((o) => o.cloid === cloid)
      return match ? match.oid : null
    } catch (error) {
      console.error(
        '[hyperliquid] resolveOidByCloid error for',
        cloid,
        errorMessage(error),
      )
      return null
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

  // Propagates errors. The connect-form probe and the status
  // probe both wrap this in their own try/catch and surface the
  // failure as a user-facing message, so swallowing here would
  // mask "user not found" / network / unauthorized-wallet errors
  // as a successful zero-balance probe. Any caller that wants
  // graceful zero-on-error semantics should wrap the call itself.
  //
  // Balance source depends on the account abstraction mode:
  //   default / disabled   - perp clearinghouse marginSummary.accountValue
  //   unifiedAccount       - spot clearinghouse USDC.total
  //   portfolioMargin      - spot clearinghouse USDC.total
  //   dexAbstraction       - falls back to perp clearinghouse
  // Hyperliquid's default for new accounts is 'unifiedAccount';
  // the perp endpoint reports zero for those, hence the branch.
  // Positions still come from clearinghouseState.assetPositions
  // regardless of mode.
  async getAccountState(): Promise<AccountState> {
    const mode = await this.resolveAbstractionMode()

    const [perp, open] = await Promise.all([
      this.info.clearinghouseState({ user: this.masterAccountAddress }),
      this.info.openOrders({ user: this.masterAccountAddress }),
    ])
    const positions = perp.assetPositions
      .filter((ap) => Number(ap.position.szi) !== 0)
      .map((ap) => ({
        pair: ap.position.coin,
        side: Number(ap.position.szi) > 0 ? ('long' as const) : ('short' as const),
        size_coin: Math.abs(Number(ap.position.szi)),
        entry_price: Number(ap.position.entryPx ?? 0),
        unrealised_pnl_usd: Number(ap.position.unrealizedPnl ?? 0),
      }))

    let balance_usd: number
    if (mode === 'unifiedAccount' || mode === 'portfolioMargin') {
      const spot = await this.info.spotClearinghouseState({
        user: this.masterAccountAddress,
      })
      const usdc = spot.balances.find((b) => b.coin === 'USDC')
      balance_usd = usdc ? Number(usdc.total) : 0
    } else {
      balance_usd = Number(perp.marginSummary.accountValue ?? 0)
    }

    return {
      balance_usd,
      positions,
      open_order_count: open.length,
      abstraction_mode: mode,
    }
  }

  // Resolves the master account's abstraction mode and caches it
  // for the lifetime of the client instance. Hyperliquid lets a
  // user toggle modes via a signed userSetAbstraction action, so
  // an instance that lives across mode flips would see stale
  // data; a fresh client is built every server-action invocation
  // so this is fine in practice. If a long-lived client ever
  // shows up (e.g. a websocket client), drop the cache or expose
  // an invalidate method.
  private async resolveAbstractionMode(): Promise<AccountAbstractionMode> {
    if (this.abstractionMode) return this.abstractionMode
    const raw = await this.info.userAbstraction({
      user: this.masterAccountAddress,
    })
    // The SDK enum is "unifiedAccount" | "portfolioMargin" |
    // "disabled" | "default" | "dexAbstraction". Cast through
    // unknown so a future widening on the SDK side does not
    // silently break our union; the fallback in the switch
    // catches anything we don't yet recognise.
    const mode = raw as AccountAbstractionMode
    switch (mode) {
      case 'default':
      case 'disabled':
      case 'unifiedAccount':
      case 'portfolioMargin':
      case 'dexAbstraction':
        this.abstractionMode = mode
        return mode
      default:
        // Unknown mode - treat as 'default' so balance reads from
        // perp clearinghouse rather than throwing. Logged so we
        // can spot the new value and add a branch.
        console.warn(
          `[hyperliquid] unknown abstraction mode ${JSON.stringify(raw)}; falling back to 'default'`,
        )
        this.abstractionMode = 'default'
        return 'default'
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
  cloid: string,
): OrderResult {
  const statuses = result?.response?.data?.statuses ?? []
  const first = statuses[0]
  if (first && typeof first === 'object') {
    if ('resting' in first) {
      const oid = (first as { resting: { oid: number } }).resting.oid
      return { ok: true, order_id: String(oid), placed_at: new Date(), cloid }
    }
    if ('filled' in first) {
      const oid = (first as { filled: { oid: number } }).filled.oid
      return { ok: true, order_id: String(oid), placed_at: new Date(), cloid }
    }
    if ('error' in first) {
      const message = String((first as { error: string }).error)
      return { ok: false, reason: `[${classifyError(message)}] ${message}` }
    }
  }
  if (typeof first === 'string') {
    if (first === 'waitingForTrigger' || first === 'waitingForFill') {
      // Trigger orders return 'waitingForTrigger' on placement.
      // The exchange has accepted the order but no oid is
      // assigned until the trigger fires. The cloid is the only
      // stable handle we have until then, so we surface
      // cloid_only=true and the pipeline persists the cloid into
      // exchange_stop_cloid / exchange_target_cloid. The monitor
      // tick resolves the real oid via info.orderStatus({user,
      // cloid}) before treating the order as still-pending.
      return {
        ok: true,
        order_id: `pending:${kind}:${Date.now()}`,
        placed_at: new Date(),
        cloid_only: true,
        cloid,
      }
    }
  }
  return { ok: false, reason: `unexpected status: ${JSON.stringify(first)}` }
}
