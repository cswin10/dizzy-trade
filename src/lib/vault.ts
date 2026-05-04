// Thin wrapper around the vault helpers in
// supabase/migrations/0002_vault_setup.sql. Each call goes through
// a security-definer Postgres function so the service-role client
// is the only path that ever touches vault.secrets directly.
//
// Storage is keyed by (tenant_id, integration). The integration
// string is the contract between callers, e.g. 'hyperliquid' for
// the API wallet private key. Multiple integrations per tenant are
// supported because user_secrets.integration is part of the unique
// constraint.

import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'

// Brand the decrypted value so it cannot be passed to anywhere
// that takes a plain string (e.g. logger, response body) without
// an explicit unwrap. Phase 2a only unwraps inside the
// HyperliquidClient constructor.
declare const decryptedBrand: unique symbol
export type DecryptedSecret = string & { readonly [decryptedBrand]: true }

export function unwrapDecrypted(secret: DecryptedSecret): string {
  return secret
}

export type StoreSecretInput = {
  tenant_id: string
  user_id: string
  integration: string
  secret: string
  // Short user-facing tag so the settings page can render
  // "0xabcd...1234" rather than implying the cleartext is shown.
  masked_preview: string
}

export async function storeSecret(input: StoreSecretInput): Promise<string> {
  const service = createServiceClient()
  const { data, error } = await service.rpc('store_user_secret', {
    p_tenant_id: input.tenant_id,
    p_user_id: input.user_id,
    p_integration: input.integration,
    p_secret: input.secret,
    p_masked_preview: input.masked_preview,
  })
  if (error) {
    throw new Error(`vault.storeSecret(${input.integration}): ${error.message}`)
  }
  if (typeof data !== 'string') {
    throw new Error('vault.storeSecret: unexpected response shape')
  }
  return data
}

export async function getSecret(
  tenantId: string,
  integration: string,
): Promise<DecryptedSecret | null> {
  const service = createServiceClient()
  const { data, error } = await service.rpc('get_user_secret', {
    p_tenant_id: tenantId,
    p_integration: integration,
  })
  if (error) {
    throw new Error(`vault.getSecret(${integration}): ${error.message}`)
  }
  if (data == null) return null
  return data as DecryptedSecret
}

export async function deleteSecret(
  tenantId: string,
  integration: string,
): Promise<void> {
  const service = createServiceClient()
  const { error } = await service.rpc('delete_user_secret', {
    p_tenant_id: tenantId,
    p_integration: integration,
  })
  if (error) {
    throw new Error(`vault.deleteSecret(${integration}): ${error.message}`)
  }
}
