-- Phase 2a wiring for the real Hyperliquid client.
--
-- The exchange_credentials shape from 0026 was scaffolded with a
-- non-null encrypted_private_key column on the assumption Phase 2
-- would write the encrypted key directly to the row. Phase 2a
-- routes the secret through Supabase Vault via the existing
-- public.store_user_secret / public.get_user_secret helpers (see
-- 0002_vault_setup.sql) instead, so vault_secret_id is the
-- authoritative pointer and the inline column is no longer
-- meaningful.
--
-- Adds master_account_address: Hyperliquid orders are signed by
-- the API wallet but trade on behalf of the master account. The
-- master account address is what the InfoClient queries for
-- balances, positions, and order status, so we must persist it
-- separately from the API wallet address.
--
-- Adds cloid on live_signals: Hyperliquid takes a 16-byte client
-- order id ("cloid") for idempotency. We derive it deterministically
-- from the signal id when placing orders, but storing it on the
-- row keeps the audit trail explicit and lets the disconnect /
-- reconnect path cancel by cloid without re-hashing.

alter table public.exchange_credentials
  add column if not exists master_account_address text,
  alter column encrypted_private_key drop not null;

-- Backfill nothing: any pre-existing rows from Phase 1 only
-- contained the placeholder encrypted_private_key value and were
-- never used to place orders. Phase 2a expects users to reconnect
-- via the settings page.

alter table public.live_signals
  add column if not exists cloid text;

create index if not exists live_signals_cloid_idx
  on public.live_signals (cloid)
  where cloid is not null;

notify pgrst, 'reload schema';
