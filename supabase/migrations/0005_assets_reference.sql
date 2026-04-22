-- Assets reference table.
--
-- Holds the Coingecko catalogue so the journal asset picker can search
-- by symbol and name without a round-trip to Coingecko on every keystroke.
-- Public reference data with no user-specific rows, so RLS stays off. The
-- seed endpoint in src/app/api/admin/seed-assets uses the service role to
-- upsert the catalogue; authenticated reads are allowed without a policy
-- because the table is not locked down.

create table public.assets_reference (
  coingecko_id text primary key,
  symbol text not null,
  name text not null,
  market_cap_rank integer,
  updated_at timestamptz default now()
);

create index assets_reference_symbol_idx
  on public.assets_reference (symbol);
create index assets_reference_name_idx
  on public.assets_reference (name);
