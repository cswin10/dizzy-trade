'use server'

// Server actions backing /settings/exchange. Three actions:
//   connectExchangeAction - validates creds against Hyperliquid
//                            testnet, encrypts the private key
//                            via Vault, inserts the row.
//   disconnectExchangeAction - deletes row + Vault secret.
//   getExchangeStatusAction - returns the connection state plus a
//                            live read of the testnet account
//                            balance and open-order count when
//                            connected.
//
// Phase 2a is testnet-only: any attempt to register mainnet
// credentials is rejected here AND in the factory. Two layers of
// gating because mainnet is real money.

import { revalidatePath } from 'next/cache'

import { HyperliquidClient } from '@/lib/exchange/hyperliquid-client'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { deleteSecret, storeSecret } from '@/lib/vault'

const VAULT_INTEGRATION_KEY = 'hyperliquid_api_wallet'

async function resolveTenant() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Not authenticated' }
  const { data: memberships, error } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
  if (error) return { ok: false as const, error: error.message }
  const tenantId = memberships?.[0]?.tenant_id
  if (!tenantId) return { ok: false as const, error: 'No tenant for user' }
  return { ok: true as const, user, tenantId }
}

const HEX_32_BYTES = /^0x[0-9a-fA-F]{64}$/
const HEX_20_BYTES = /^0x[0-9a-fA-F]{40}$/

function maskPrivateKey(key: string): string {
  if (key.length < 10) return '••••••••'
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

export type ConnectExchangeInput = {
  api_wallet_private_key: string
  api_wallet_address: string
  master_account_address: string
  network: 'testnet'
}

export type ConnectExchangeResult =
  | { ok: true }
  | { ok: false; message: string }

export async function connectExchangeAction(
  input: ConnectExchangeInput,
): Promise<ConnectExchangeResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const privateKey = input.api_wallet_private_key.trim()
  const apiWalletAddress = input.api_wallet_address.trim().toLowerCase()
  const masterAccountAddress = input.master_account_address
    .trim()
    .toLowerCase()

  if (!HEX_32_BYTES.test(privateKey)) {
    return {
      ok: false,
      message:
        'API wallet private key must be a 0x-prefixed 32-byte hex string',
    }
  }
  if (!HEX_20_BYTES.test(apiWalletAddress)) {
    return {
      ok: false,
      message:
        'API wallet address must be a 0x-prefixed 20-byte hex string',
    }
  }
  if (!HEX_20_BYTES.test(masterAccountAddress)) {
    return {
      ok: false,
      message:
        'Master account address must be a 0x-prefixed 20-byte hex string',
    }
  }
  if (input.network !== 'testnet') {
    // Belt-and-braces: the form only offers testnet, but reject
    // anything else here so a future hand-edited POST cannot
    // route to mainnet.
    return {
      ok: false,
      message: 'Only testnet is supported in Phase 2a',
    }
  }

  // Probe the testnet API before persisting anything: if the
  // creds are bad we want the operator to see a clear error
  // rather than discovering it later when /live tries to place
  // an order.
  let probe: HyperliquidClient
  try {
    probe = new HyperliquidClient({
      privateKey: privateKey as `0x${string}`,
      apiWalletAddress: apiWalletAddress as `0x${string}`,
      masterAccountAddress: masterAccountAddress as `0x${string}`,
      network: 'testnet',
    })
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Constructor rejected creds: ${error.message}`
          : 'Could not construct client',
    }
  }
  try {
    const state = await probe.getAccountState()
    if (!Number.isFinite(state.balance_usd)) {
      return {
        ok: false,
        message:
          'Testnet probe returned an unexpected response. Check your master account address.',
      }
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Testnet probe failed: ${error.message}`
          : 'Testnet probe failed',
    }
  }

  // Probe passed - encrypt + persist. storeSecret is idempotent
  // on (tenant, integration); a reconnect overwrites the prior
  // private key cleanly.
  const vaultSecretId = await storeSecret({
    tenant_id: ctx.tenantId,
    user_id: ctx.user.id,
    integration: VAULT_INTEGRATION_KEY,
    secret: privateKey,
    masked_preview: maskPrivateKey(privateKey),
  })

  const service = createServiceClient()
  const { error: upsertError } = await service
    .from('exchange_credentials')
    .upsert(
      {
        tenant_id: ctx.tenantId,
        user_id: ctx.user.id,
        exchange: 'hyperliquid',
        network: 'testnet',
        api_wallet_address: apiWalletAddress,
        master_account_address: masterAccountAddress,
        encrypted_private_key: null,
        vault_secret_id: vaultSecretId,
        enabled: true,
      },
      { onConflict: 'tenant_id,exchange,network' },
    )
  if (upsertError) {
    return { ok: false, message: upsertError.message }
  }

  revalidatePath('/settings/exchange')
  revalidatePath('/live')
  return { ok: true }
}

export async function disconnectExchangeAction(): Promise<ConnectExchangeResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }
  const service = createServiceClient()
  const { error: delError } = await service
    .from('exchange_credentials')
    .delete()
    .eq('tenant_id', ctx.tenantId)
    .eq('exchange', 'hyperliquid')
  if (delError) {
    return { ok: false, message: delError.message }
  }
  // Best-effort vault cleanup. If the secret never existed (e.g.
  // a row was inserted manually without a vault_secret_id) we
  // swallow the error so the disconnect still succeeds from the
  // operator's perspective.
  try {
    await deleteSecret(ctx.tenantId, VAULT_INTEGRATION_KEY)
  } catch (error) {
    console.warn(
      '[exchange] vault deleteSecret failed during disconnect:',
      error instanceof Error ? error.message : error,
    )
  }
  revalidatePath('/settings/exchange')
  revalidatePath('/live')
  return { ok: true }
}

export type ExchangeStatus =
  | {
      connected: false
      reason: 'no_credentials' | 'mainnet_blocked' | 'misconfigured'
      detail?: string
    }
  | {
      connected: true
      network: 'testnet'
      api_wallet_address: string
      master_account_address: string
      balance_usd: number
      open_position_count: number
      open_order_count: number
    }

export async function getExchangeStatusAction(): Promise<ExchangeStatus> {
  const ctx = await resolveTenant()
  if (!ctx.ok) {
    return { connected: false, reason: 'no_credentials', detail: ctx.error }
  }
  const service = createServiceClient()
  const { data: row } = await service
    .from('exchange_credentials')
    .select(
      'network, api_wallet_address, master_account_address, vault_secret_id, enabled',
    )
    .eq('tenant_id', ctx.tenantId)
    .eq('exchange', 'hyperliquid')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!row) {
    return { connected: false, reason: 'no_credentials' }
  }
  if (row.network === 'mainnet') {
    return {
      connected: false,
      reason: 'mainnet_blocked',
      detail:
        'Mainnet credentials are stored but the factory will not use them in Phase 2a.',
    }
  }
  if (row.network !== 'testnet' || !row.master_account_address) {
    return {
      connected: false,
      reason: 'misconfigured',
      detail: 'Credentials row is missing required fields.',
    }
  }
  // Probe the testnet account so the page shows a current
  // balance. We instantiate the client through the factory
  // wouldn't help us here (we need the read whether or not the
  // factory is testnet-enabled), so build directly.
  const { getSecret, unwrapDecrypted } = await import('@/lib/vault')
  const secret = await getSecret(ctx.tenantId, VAULT_INTEGRATION_KEY)
  if (!secret) {
    return {
      connected: false,
      reason: 'misconfigured',
      detail: 'Vault secret missing for this tenant.',
    }
  }
  try {
    const probe = new HyperliquidClient({
      privateKey: unwrapDecrypted(secret) as `0x${string}`,
      apiWalletAddress: row.api_wallet_address as `0x${string}`,
      masterAccountAddress: row.master_account_address as `0x${string}`,
      network: 'testnet',
    })
    const state = await probe.getAccountState()
    return {
      connected: true,
      network: 'testnet',
      api_wallet_address: row.api_wallet_address,
      master_account_address: row.master_account_address,
      balance_usd: state.balance_usd,
      open_position_count: state.positions.length,
      open_order_count: state.open_order_count,
    }
  } catch (error) {
    return {
      connected: false,
      reason: 'misconfigured',
      detail:
        error instanceof Error
          ? `Probe failed: ${error.message}`
          : 'Probe failed',
    }
  }
}
