// Selects which exchange client the live pipeline talks to. The
// pipeline does not know which one it gets; it consumes the
// uniform ExchangeClient interface defined in ./types.ts.
//
// Phase 1 returned the mock unconditionally. Phase 2a queries
// exchange_credentials for the tenant and, when a row is present
// and points at a network we've enabled (testnet only for now),
// constructs a real HyperliquidClient. Tenants without credentials
// fall back to the mock so the dev loop on /live keeps working
// without an API wallet.
//
// Network gating lives here on purpose: a single switch governs
// whether a real-money path can be reached. Phase 2c will relax
// the mainnet check, ideally behind an explicit per-row consent
// flag plus a feature flag.

import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'
import { getSecret, unwrapDecrypted } from '@/lib/vault'

import { HyperliquidClient } from './hyperliquid-client'
import {
  getMockHyperliquidClient,
  type MockHyperliquidClient,
} from './mock-hyperliquid'
import type { ExchangeClient, MockExchangeClient } from './types'

const VAULT_INTEGRATION_KEY = 'hyperliquid_api_wallet'

// Phase 2a: testnet only. Anything else routes to the mock so a
// misconfigured row cannot send to mainnet by accident.
const ALLOWED_NETWORKS: ReadonlySet<'testnet'> = new Set(['testnet'])

export type ExchangeClientChoice = {
  client: ExchangeClient
  flavour: 'mock' | 'hyperliquid'
  network: 'testnet' | null
}

export async function getExchangeClient(
  tenantId: string,
): Promise<ExchangeClientChoice> {
  const service = createServiceClient()
  const { data: row, error } = await service
    .from('exchange_credentials')
    .select(
      'id, exchange, network, api_wallet_address, master_account_address, vault_secret_id, enabled',
    )
    .eq('tenant_id', tenantId)
    .eq('exchange', 'hyperliquid')
    .eq('enabled', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !row) {
    return mockChoice()
  }
  if (!ALLOWED_NETWORKS.has(row.network as 'testnet')) {
    // Mainnet (or any future network) explicitly falls back to
    // mock. The settings page surfaces the "mainnet not yet
    // enabled" banner so the operator does not silently land on
    // the mock during configuration.
    return mockChoice()
  }
  if (!row.master_account_address) {
    return mockChoice()
  }
  const secret = await getSecret(tenantId, VAULT_INTEGRATION_KEY)
  if (!secret) {
    return mockChoice()
  }
  const privateKey = unwrapDecrypted(secret) as `0x${string}`
  const client = new HyperliquidClient({
    privateKey,
    apiWalletAddress: row.api_wallet_address as `0x${string}`,
    masterAccountAddress: row.master_account_address as `0x${string}`,
    network: 'testnet',
  })
  return { client, flavour: 'hyperliquid', network: 'testnet' }
}

function mockChoice(): ExchangeClientChoice {
  return {
    client: getMockHyperliquidClient(),
    flavour: 'mock',
    network: null,
  }
}

// Convenience accessor for mock-only debug surfaces (the /live
// page's force-fill / push-tick controls and the audit log
// viewer). Returns null when the active client is not the mock
// so callers can hide the debug UI under Phase 2 without
// crashing. Async because picking the active client requires a
// tenant-scoped DB lookup.
export async function getMockClientIfActive(
  tenantId: string,
): Promise<MockExchangeClient | null> {
  const choice = await getExchangeClient(tenantId)
  if (choice.flavour !== 'mock') return null
  return choice.client as MockHyperliquidClient
}

export type { ExchangeClient }
