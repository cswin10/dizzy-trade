-- Hyperliquid position tracking.
--
-- Closes the discipline loop: a trade is logged in Dizzy Trade, the
-- user places it on Hyperliquid, then clicks "Mark as live" so the
-- system links the journal entry to the open exchange position.
-- Scanner polls open positions every 60 seconds. When a position
-- closes on the exchange, the journal updates automatically with
-- exit price, time, PnL, and outcome.
--
-- v1 is read-only: Hyperliquid exposes positions and fills publicly
-- given an account address, so we only need the user's main address.
-- No API wallet, no signing, no Vault. v1.1 will add an API wallet
-- for trade execution.
--
-- live_status flow:
--   not_live      logged in journal, not yet placed on exchange
--   pending_link  user clicked Mark as live, system is matching
--   live          linked to an open Hyperliquid position
--   closed_auto   position closed on exchange, journal auto-updated
--   closed_manual user updated exit fields before auto-detect ran
--
-- Idempotent column adds so the migration can be re-run safely.

alter table public.trades
  add column if not exists hyperliquid_position_id text,
  add column if not exists hyperliquid_address text,
  add column if not exists live_status text
    check (
      live_status in (
        'not_live',
        'pending_link',
        'live',
        'closed_auto',
        'closed_manual'
      )
    )
    default 'not_live',
  add column if not exists linked_at timestamptz,
  add column if not exists last_synced_at timestamptz;

create index if not exists trades_live_status_idx
  on public.trades (live_status)
  where live_status in ('live', 'pending_link');

create index if not exists trades_hyperliquid_position_idx
  on public.trades (hyperliquid_position_id)
  where hyperliquid_position_id is not null;

-- Per-tick snapshot of every live position on Hyperliquid. Lets us
-- show unrealised PnL on the dashboard and gives us an audit trail
-- when a close detection looks wrong.
create table if not exists public.hyperliquid_position_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trade_id uuid not null references public.trades(id) on delete cascade,
  coin text not null,
  size numeric not null,
  entry_px numeric,
  position_value numeric,
  unrealized_pnl numeric,
  liquidation_px numeric,
  captured_at timestamptz default now()
);

create index if not exists hyperliquid_snapshots_trade_idx
  on public.hyperliquid_position_snapshots (trade_id, captured_at desc);

create index if not exists hyperliquid_snapshots_tenant_idx
  on public.hyperliquid_position_snapshots (tenant_id, captured_at desc);

alter table public.hyperliquid_position_snapshots enable row level security;

drop policy if exists hyperliquid_snapshots_select_own
  on public.hyperliquid_position_snapshots;
create policy hyperliquid_snapshots_select_own
  on public.hyperliquid_position_snapshots
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

grant select on public.hyperliquid_position_snapshots to authenticated;

-- The user's Hyperliquid main account address. v1 is read-only so
-- the api_wallet_address from earlier drafts is omitted; v1.1 adds
-- it back when we wire trade execution.
create table if not exists public.user_hyperliquid_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade unique,
  main_address text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.user_hyperliquid_config enable row level security;

drop policy if exists hyperliquid_config_select_own on public.user_hyperliquid_config;
create policy hyperliquid_config_select_own on public.user_hyperliquid_config
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

grant select on public.user_hyperliquid_config to authenticated;
