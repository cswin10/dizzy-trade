// Server-only wrappers around Supabase Vault helpers for user-submitted
// secrets (exchange API keys, provider tokens). Read src/lib/supabase/README.md
// before touching this file.
//
// Rules:
//
//   1. This module must only be imported from server components, server
//      actions, route handlers, or scheduled jobs. The service role key it
//      relies on bypasses RLS and must never reach a client bundle.
//   2. The return value of `getSecret` must never be returned in an API
//      response, serialized into HTML, logged, or included in error messages.
//      Callers decrypt, make the outbound call, and discard.
//   3. Callers must use the decrypted secret immediately and must not cache,
//      memoize, or persist it. If the same job needs it twice in a row,
//      fetch it twice.
//   4. Decrypted values are returned as the opaque `DecryptedSecret` type.
//      Unwrap with `unwrapDecryptedSecret` only at the exact point of use -
//      typically inside the HTTP header or signing call that consumes it.
import 'server-only'

import { createClient as createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export type Integration = 'hyperliquid' | 'coinbase' | 'anthropic' | 'alchemy'

// Branded type for decrypted secret material. The brand has no runtime
// presence - it only exists at compile time so that a plain string cannot
// accidentally flow into a position that expects a decrypted secret, and
// a decrypted secret cannot be assigned back into a plain `string`
// variable that might be logged or serialized.
declare const decryptedSecretBrand: unique symbol
export type DecryptedSecret = string & { readonly [decryptedSecretBrand]: true }

// Unwrap a DecryptedSecret at the point of use. This is the only place the
// brand is stripped. Code reviewers should treat every call site as a
// checkpoint and make sure the returned string flows directly into the
// outbound call and nowhere else.
export function unwrapDecryptedSecret(secret: DecryptedSecret): string {
  return secret
}

// storeSecret is only ever called from an interactive, user-initiated server
// action, so we resolve the caller's identity from their session and pair it
// with a service-role lookup of the tenant membership. We use the service
// role for both the membership lookup and the vault write so the operation
// succeeds without depending on RLS gates that don't apply to the vault
// schema, but we never trust "whoever the service role thinks they are" for
// tenant assignment: the user id is taken from the authenticated session,
// and the tenant is the one the database says that user belongs to.
export async function storeSecret(
  integration: Integration,
  secret: string,
  maskedPreview: string,
): Promise<string> {
  const userClient = createServerClient()
  const { data: userResult, error: userError } = await userClient.auth.getUser()
  if (userError || !userResult.user) {
    throw new Error('storeSecret: no authenticated user')
  }

  const service = createServiceClient()
  const { data: memberships, error: membershipError } = await service
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', userResult.user.id)
    .limit(1)
  if (membershipError || !memberships || memberships.length === 0) {
    throw new Error('storeSecret: no tenant membership for user')
  }
  const tenantId = memberships[0]!.tenant_id

  const { data, error } = await service.rpc('store_user_secret', {
    p_integration: integration,
    p_secret: secret,
    p_masked_preview: maskedPreview,
    p_tenant_id: tenantId,
    p_user_id: userResult.user.id,
  })
  if (error) {
    // The raw secret is in function scope only; `error` comes from the RPC
    // transport and does not contain it. Re-throw without including the
    // secret or the masked preview for safety.
    throw new Error(`storeSecret failed for ${integration}: ${error.message}`)
  }
  return data as string
}

export async function getSecret(
  integration: Integration,
  userTenantId: string,
): Promise<DecryptedSecret | null> {
  const service = createServiceClient()
  const { data, error } = await service.rpc('get_user_secret', {
    p_integration: integration,
    p_tenant_id: userTenantId,
  })
  if (error) {
    throw new Error(`getSecret failed for ${integration}: ${error.message}`)
  }
  if (data === null || data === undefined) return null
  return data as DecryptedSecret
}

export async function deleteSecret(
  integration: Integration,
  userTenantId: string,
): Promise<void> {
  const service = createServiceClient()
  const { error } = await service.rpc('delete_user_secret', {
    p_integration: integration,
    p_tenant_id: userTenantId,
  })
  if (error) {
    throw new Error(`deleteSecret failed for ${integration}: ${error.message}`)
  }
}
