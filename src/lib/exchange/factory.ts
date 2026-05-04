// Selects which exchange client the live pipeline gets at run
// time. Phase 1 always returns the mock; Phase 2 will branch on a
// per-tenant network setting (testnet / mainnet) and instantiate
// a real Hyperliquid client signed against the operator's API
// wallet.
//
// Keeping this dispatch in one place means the pipeline never has
// to know which client it is talking to, and the UI's "test mode"
// toggle (when it lands in Phase 2) only has to flip a column on
// exchange_credentials, not branch in fifteen call sites.

import {
  getMockHyperliquidClient,
  type MockHyperliquidClient,
} from './mock-hyperliquid'
import type { ExchangeClient, MockExchangeClient } from './types'

export type ExchangeClientChoice = {
  client: ExchangeClient
  // Phase 1 always tags the choice as 'mock'; Phase 2 will return
  // 'hyperliquid' for real and keep 'mock' as an explicit dev
  // override.
  flavour: 'mock' | 'hyperliquid'
}

export function getExchangeClient(): ExchangeClientChoice {
  return { client: getMockHyperliquidClient(), flavour: 'mock' }
}

// Convenience accessor for mock-only debug surfaces (the /live
// page's "advance price" controls and the audit log viewer).
// Returns null when the active client is not the mock so callers
// can hide the debug UI in Phase 2 without crashing.
export function getMockClientIfActive(): MockExchangeClient | null {
  const choice = getExchangeClient()
  if (choice.flavour !== 'mock') return null
  return choice.client as MockHyperliquidClient
}

export type { ExchangeClient }
