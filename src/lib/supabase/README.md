# Supabase layer

Three Supabase clients plus a Vault wrapper. Pick the right one.

| File         | Runs on | Auth context           | When to use                                                                        |
| ------------ | ------- | ---------------------- | ---------------------------------------------------------------------------------- |
| `client.ts`  | Browser | Anon key + user JWT    | Client components                                                                  |
| `server.ts`  | Server  | Anon key + user cookie | Server components, server actions, route handlers acting on behalf of the end user |
| `service.ts` | Server  | Service role key       | Admin paths, scheduled jobs, anything that must bypass RLS                         |
| `vault.ts`   | Server  | Service role key       | Reading and writing user-submitted secrets                                         |

## Secrets model

User-submitted secrets (exchange API keys, provider tokens) are never stored
in plaintext columns. They live in `vault.secrets`, referenced from
`public.user_secrets` by `vault_secret_id`. The `user_secrets` row also
carries a `masked_preview` like `sk_...abcd` that is safe to show in the UI.

Three SQL helpers wrap Vault:

- `store_user_secret(integration, secret, masked_preview, tenant_id?, user_id?)`
- `get_user_secret(integration, tenant_id?)`
- `delete_user_secret(integration, tenant_id?)`

All three are `security definer` and are granted to `service_role` only.
`anon` and `authenticated` cannot call them at all. RLS on `user_secrets`
gates the metadata row by tenant, but RLS does not and cannot gate
`vault.secrets` itself - decryption flows through the helpers, which is why
the service role is the only caller.

The TypeScript surface is `vault.ts`:

- `storeSecret(integration, secret, maskedPreview)` resolves the caller's
  tenant from the user session, then calls the SQL helper with the service
  role.
- `getSecret(integration, userTenantId)` returns the decrypted value as an
  opaque `DecryptedSecret`.
- `deleteSecret(integration, userTenantId)` drops both the metadata row and
  the vault row.

## Threat model

What we defend against:

1. **Database dump or backup leak.** If the Postgres dump leaks without the
   Vault encryption key, the secrets remain ciphertext. A plaintext
   `api_key` column would be game over; Vault keeps them useless without
   the key.
2. **Cross-tenant reads.** RLS on `user_secrets` pins metadata rows to the
   caller's tenant. The service role bypasses RLS, so the helpers pass
   `tenant_id` explicitly and we never fetch across tenants.
3. **Accidental exposure in responses.** The `DecryptedSecret` opaque type
   forces an explicit unwrap (`unwrapDecryptedSecret`) at the point of use.
   A plain `string` cannot flow into a position that expects a
   `DecryptedSecret`, and a `DecryptedSecret` cannot be silently returned
   from a server action that is typed to return a plain response object.
4. **Accidental logging.** Because the decrypted value is only unwrapped at
   the outbound call site, it never lands in a variable that a generic
   logger or serializer would pick up.

What we do **not** defend against and do not try to:

- A compromised service role key. If the key leaks, everything in Vault is
  decryptable. The service role key lives only in Vercel env and is never
  shipped to the client.
- A malicious server action. Anyone with commit rights can write code that
  calls `unwrapDecryptedSecret` and leaks the result. The brand type and
  this README raise the floor; code review is still required.
- Browser-side exfiltration after a user has authenticated and decrypted
  upstream. Decryption never happens on the client and decrypted values
  never cross the network boundary back to the browser.

## Rules for callers

1. Only import `vault.ts` from server components, server actions, route
   handlers, or scheduled jobs. Never from a client component.
2. Never return the decrypted value in an API response, render it into
   HTML, or log it. `error.message` can leak if you include the secret in
   an error message you construct; don't.
3. Fetch, use, discard. Do not cache or memoize. If you need the secret
   twice in a row, call `getSecret` twice.
4. Unwrap `DecryptedSecret` only at the outbound call site - inside the
   `Authorization` header, inside the signing call, inside the exchange
   SDK constructor argument. Every call to `unwrapDecryptedSecret` is a
   review checkpoint.

v1 has no UI that collects secrets and no integration that consumes them.
The plumbing is here so that when Hyperliquid, Coinbase, Anthropic, or
Alchemy integrations ship, there is exactly one correct path to follow.
