-- Live deployments and signals.
--
-- A "deployment" is the long-lived bind of a strategy to live
-- execution: which pairs, what risk, what guardrails. A "signal"
-- is one specific trade idea fired by a deployment, which then
-- moves through a state machine (pending_confirmation -> confirmed
-- -> order_placed -> filled -> closed) as the user confirms it
-- and the exchange reports back.
--
-- Phase 1 ships against a mock exchange client; Phase 2 swaps in
-- real Hyperliquid. The schema is exchange-agnostic on purpose:
-- exchange_credentials is just a per-tenant key holder, and
-- live_signals records the exchange_order_id strings the client
-- handed back without caring how they were generated.
--
-- is_active on strategies / strategy_definitions becomes
-- deployment_status here. The new column is a four-state enum so
-- "draft", "live", "paused", and "archived" can all be expressed
-- without bolting more booleans on. The conversion below preserves
-- the previous true/false semantics: anything previously active
-- becomes 'live', everything else 'draft'.

-- --------------------------------------------------------------
-- 1. Replace is_active with deployment_status
-- --------------------------------------------------------------

alter table public.strategy_definitions
  add column if not exists deployment_status text
    not null default 'draft'
    check (deployment_status in ('draft', 'live', 'paused', 'archived'));

update public.strategy_definitions
  set deployment_status = case when is_active then 'live' else 'draft' end;

-- Existing partial unique constraint (introduced in 0022) was
-- "one active per tenant"; rebuild it against deployment_status.
-- Names are taken verbatim from 0022 so DROP IF EXISTS finds them
-- on a database that already migrated through that version.
drop index if exists strategy_definitions_one_active_per_tenant;
drop index if exists strategy_definitions_active_idx;
create unique index strategy_definitions_one_live_per_tenant
  on public.strategy_definitions (tenant_id)
  where deployment_status = 'live';

alter table public.strategy_definitions drop column if exists is_active;

alter table public.strategies
  add column if not exists deployment_status text
    not null default 'draft'
    check (deployment_status in ('draft', 'live', 'paused', 'archived'));

update public.strategies
  set deployment_status = case when is_active then 'live' else 'draft' end;

-- Legacy strategies are single-tenant in this codebase (no
-- tenant_id column) so the previous index was a global "only one
-- active row at a time" partial unique on is_active itself.
-- Rebuild it as a global "only one live row" against the new
-- column. The expression-index syntax (deployment_status) where
-- deployment_status = 'live' is the partial-unique equivalent on
-- the new column.
drop index if exists strategies_one_active;
drop index if exists strategies_active_idx;
create unique index strategies_one_live
  on public.strategies (deployment_status)
  where deployment_status = 'live';

alter table public.strategies drop column if exists is_active;

-- --------------------------------------------------------------
-- 2. strategy_deployments
-- --------------------------------------------------------------

create table public.strategy_deployments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Exactly one strategy source: composable definition OR legacy
  -- framework strategy. Constraint enforced below.
  strategy_definition_id uuid references public.strategy_definitions(id) on delete cascade,
  legacy_strategy_id uuid references public.strategies(id) on delete cascade,

  live_risk_gbp numeric not null,
  live_pairs text[] not null,
  live_max_concurrent_positions int not null default 1,
  live_max_daily_loss_gbp numeric,
  live_max_consecutive_losers int,
  live_order_lifetime_candles int not null default 1,
  -- Phase 2 will toggle this on. Phase 1 keeps it false at all
  -- times: every signal goes through manual confirmation.
  live_auto_execute_enabled boolean not null default false,

  -- Provenance: which backtest run did the operator look at when
  -- they decided to deploy? Snapshot copied alongside so future
  -- edits to the source backtest do not change what the deployer
  -- saw at deploy time.
  source_backtest_run_id uuid references public.backtest_runs(id) on delete set null,
  source_backtest_summary jsonb,

  deployed_at timestamptz not null default now(),
  paused_at timestamptz,
  resumed_at timestamptz,
  archived_at timestamptz,
  status text not null default 'live'
    check (status in ('live', 'paused', 'archived')),

  constraint deployment_strategy_xor check (
    (strategy_definition_id is not null and legacy_strategy_id is null) or
    (strategy_definition_id is null and legacy_strategy_id is not null)
  )
);

create index strategy_deployments_tenant_idx
  on public.strategy_deployments (tenant_id, deployed_at desc);
create index strategy_deployments_active_idx
  on public.strategy_deployments (tenant_id, status)
  where status = 'live';

alter table public.strategy_deployments enable row level security;

create policy strategy_deployments_select on public.strategy_deployments
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy strategy_deployments_insert on public.strategy_deployments
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

create policy strategy_deployments_update on public.strategy_deployments
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy strategy_deployments_delete on public.strategy_deployments
  for delete to authenticated
  using (tenant_id = public.current_tenant_id());

-- --------------------------------------------------------------
-- 3. live_signals
-- --------------------------------------------------------------

create table public.live_signals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  deployment_id uuid not null
    references public.strategy_deployments(id) on delete cascade,

  pair text not null,
  direction text not null check (direction in ('long', 'short')),
  signal_at timestamptz not null,
  signal_close_price numeric not null,
  intended_entry_price numeric not null,
  intended_stop_price numeric not null,
  intended_target_price numeric not null,
  intended_size_coin numeric not null,
  intended_size_usd numeric not null,
  intended_risk_gbp numeric not null,
  intended_rr numeric not null,

  status text not null default 'pending_confirmation'
    check (
      status in (
        'pending_confirmation',
        'confirmed',
        'order_placed',
        'filled',
        'expired_unfilled',
        'cancelled',
        'closed_at_stop',
        'closed_at_target',
        'skipped_by_user',
        'skipped_max_positions',
        'skipped_daily_loss',
        'skipped_consecutive_losers',
        'failed'
      )
    ),
  confirmed_at timestamptz,
  confirmation_source text
    check (confirmation_source in ('telegram', 'app', 'auto')),
  expires_at timestamptz,

  exchange_order_id text,
  exchange_stop_order_id text,
  exchange_target_order_id text,

  filled_at timestamptz,
  fill_price numeric,
  closed_at timestamptz,
  exit_price numeric,
  exit_reason text
    check (exit_reason in ('stop', 'target', 'manual', 'expired')),

  realised_pnl_gbp numeric,
  realised_r_multiple numeric,

  -- The journal in this codebase is the trades table (see
  -- migration 0001). Keep the link nullable so closing a signal
  -- never blocks on journal insert failure.
  journal_trade_id uuid references public.trades(id) on delete set null,
  notification_sent_at timestamptz,
  telegram_sent_at timestamptz,
  telegram_message_id text,
  failure_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index live_signals_deployment_idx
  on public.live_signals (deployment_id, signal_at desc);

-- Pending-state index used by the dashboard list and the monitor
-- job's "find open positions" query. Partial index so the table
-- stays cheap to scan once a signal is in a terminal state.
create index live_signals_pending_idx
  on public.live_signals (tenant_id, status)
  where status in ('pending_confirmation', 'confirmed', 'order_placed', 'filled');

create index live_signals_telegram_idx
  on public.live_signals (telegram_message_id)
  where telegram_message_id is not null;

alter table public.live_signals enable row level security;

create policy live_signals_select on public.live_signals
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy live_signals_insert on public.live_signals
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

create policy live_signals_update on public.live_signals
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy live_signals_delete on public.live_signals
  for delete to authenticated
  using (tenant_id = public.current_tenant_id());

-- updated_at trigger so the monitor loop's update statements
-- automatically refresh the timestamp without every caller having
-- to remember.
create or replace function public.live_signals_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists live_signals_updated_at on public.live_signals;
create trigger live_signals_updated_at
  before update on public.live_signals
  for each row execute function public.live_signals_set_updated_at();

-- --------------------------------------------------------------
-- 4. exchange_credentials
-- --------------------------------------------------------------

create table public.exchange_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  exchange text not null check (exchange in ('hyperliquid')),
  network text not null default 'testnet'
    check (network in ('testnet', 'mainnet')),
  api_wallet_address text not null,
  -- Phase 1 stores the encrypted private key as base64 in this
  -- column or - preferred - a Vault secret id. The actual Vault
  -- wiring lands in Phase 2; the column is here so Phase 1 can
  -- already insert placeholder rows.
  encrypted_private_key text not null,
  vault_secret_id text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, exchange, network)
);

alter table public.exchange_credentials enable row level security;

create policy exchange_credentials_select on public.exchange_credentials
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy exchange_credentials_insert on public.exchange_credentials
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

create policy exchange_credentials_update on public.exchange_credentials
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy exchange_credentials_delete on public.exchange_credentials
  for delete to authenticated
  using (tenant_id = public.current_tenant_id());
