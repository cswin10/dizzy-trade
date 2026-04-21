-- Initial schema for Dizzy Trade.
--
-- Multi-tenant model
-- ------------------
-- Every domain row belongs to a tenant, and the tenant is the unit of data
-- isolation. We keep `tenants` separate from `auth.users` and join them
-- through `tenant_members` even though v1 launches with exactly one user per
-- tenant. The reason is that shared tenants (teams, households, funds) are on
-- the near roadmap. Splitting the relationship now means we never have to
-- rewrite foreign keys on `trades`, `rules`, or `watchlist_assets` later, and
-- we never have to migrate historical data from a one-to-one `users -> data`
-- model to a many-to-one `users -> tenants -> data` model.
--
-- RLS is enforced on every domain table. Policies compare `tenant_id` against
-- `current_tenant_id()`, a security-definer helper that reads the caller's
-- membership from `tenant_members`. A signup trigger on `auth.users` creates
-- a tenants row and an owner membership in the same transaction, so the very
-- first query a new user makes already resolves to a tenant.

-- Extensions
create extension if not exists pgcrypto;
create extension if not exists supabase_vault;

-- Tables
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz default now(),
  unique (tenant_id, user_id)
);

create table public.watchlist_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  coingecko_id text not null,
  symbol text not null,
  name text not null,
  narrative_tags text[] default '{}',
  created_at timestamptz default now(),
  unique (tenant_id, coingecko_id)
);

create table public.trades (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_symbol text not null,
  coingecko_id text,
  direction text not null check (direction in ('long', 'short')),
  entry_price numeric not null,
  entry_size numeric not null,
  leverage numeric default 1,
  venue text not null,
  narrative_tag text,
  setup_type text,
  thesis text,
  entry_at timestamptz not null default now(),
  exit_price numeric,
  exit_size numeric,
  exit_at timestamptz,
  pnl numeric,
  outcome text default 'open'
    check (outcome in ('win', 'loss', 'breakeven', 'open')),
  lesson text,
  source text not null default 'manual'
    check (source in ('manual', 'hyperliquid', 'coinbase', 'onchain')),
  external_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rule_type text not null check (
    rule_type in (
      'max_position_size',
      'max_daily_loss',
      'max_open_positions',
      'max_leverage'
    )
  ),
  threshold numeric not null,
  scope_type text not null default 'all'
    check (scope_type in ('all', 'narrative', 'asset')),
  scope_value text,
  active boolean not null default true,
  created_at timestamptz default now()
);

-- Indexes
create index trades_tenant_entry_at_idx
  on public.trades (tenant_id, entry_at desc);
create index trades_tenant_asset_symbol_idx
  on public.trades (tenant_id, asset_symbol);
create index trades_tenant_narrative_tag_idx
  on public.trades (tenant_id, narrative_tag);
create index trades_tenant_outcome_idx
  on public.trades (tenant_id, outcome);
create index watchlist_assets_tenant_idx
  on public.watchlist_assets (tenant_id);
create index rules_tenant_active_idx
  on public.rules (tenant_id, active);

-- Tenant membership lookup helper.
--
-- Runs as `security definer` so that a caller can resolve their own tenant
-- even before any policy on `tenant_members` would let them read the row
-- directly. `stable` because it reads from the database but never mutates.
-- `search_path` is pinned so schema-resolution cannot be subverted by a
-- caller who has set a custom search path.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id
  from public.tenant_members
  where user_id = auth.uid()
  limit 1
$$;

grant execute on function public.current_tenant_id() to authenticated;

-- Enable RLS
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.watchlist_assets enable row level security;
alter table public.trades enable row level security;
alter table public.rules enable row level security;

-- tenants: readable by members only. Inserts, updates, and deletes are
-- reserved for the signup trigger and the service role; no policy grants
-- those actions to authenticated users.
create policy tenants_select on public.tenants
  for select
  to authenticated
  using (id = public.current_tenant_id());

-- tenant_members: readable by members of the same tenant. Writes are
-- reserved for the signup trigger and the service role.
create policy tenant_members_select on public.tenant_members
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- watchlist_assets: full CRUD scoped to the caller's tenant.
create policy watchlist_assets_select on public.watchlist_assets
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy watchlist_assets_insert on public.watchlist_assets
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

create policy watchlist_assets_update on public.watchlist_assets
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy watchlist_assets_delete on public.watchlist_assets
  for delete
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- trades: full CRUD scoped to the caller's tenant.
create policy trades_select on public.trades
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy trades_insert on public.trades
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

create policy trades_update on public.trades
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy trades_delete on public.trades
  for delete
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- rules: full CRUD scoped to the caller's tenant.
create policy rules_select on public.rules
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy rules_insert on public.rules
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

create policy rules_update on public.rules
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy rules_delete on public.rules
  for delete
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- Signup bootstrap.
--
-- Runs on every new row in `auth.users`. Creates a tenant named after the
-- user's email and a corresponding `owner` membership in the same
-- transaction, so a newly signed-up user always has exactly one tenant
-- from their first request onwards. Declared `security definer` so the
-- trigger can write into `public` tables regardless of the caller.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_tenant_id uuid;
begin
  insert into public.tenants (name)
  values (new.email)
  returning id into new_tenant_id;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (new_tenant_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
