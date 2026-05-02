-- Composable strategy definitions.
--
-- The existing public.strategies table couples a strategy to a
-- single hardcoded framework_id (mean_reversion_v1 etc). That model
-- did its job for v1 but it cannot express anything novel without
-- shipping new framework code.
--
-- This new table stores the strategy as a JSON document: entry
-- groups of AND-ed conditions, OR-ed across groups, plus stop /
-- target / sizing rules. The shape is validated in application
-- code via zod (see src/lib/strategies/schema.ts) and evaluated
-- by the strategy evaluator engine (src/lib/strategies/evaluator.ts).
-- Postgres holds the document but does not parse it.
--
-- The two tables coexist for now. The scanner and backtester will
-- learn to read this new table in a later prompt; until then the
-- old strategies table stays the source of truth for live signals
-- and the new one is read only by the (forthcoming) strategy
-- composer UI and validator.
--
-- RLS: tenant-scoped, full CRUD for the owner. is_archived is a
-- soft-delete flag so a strategy that informed past trades stays
-- referenceable from the analytics surface even after the operator
-- moves on.

create table public.strategy_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  definition jsonb not null,
  schema_version integer not null default 1,
  is_archived boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index strategy_definitions_tenant_idx
  on public.strategy_definitions (tenant_id, is_archived, created_at desc);

alter table public.strategy_definitions enable row level security;

create policy strategy_definitions_select on public.strategy_definitions
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy strategy_definitions_insert on public.strategy_definitions
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

create policy strategy_definitions_update on public.strategy_definitions
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy strategy_definitions_delete on public.strategy_definitions
  for delete
  to authenticated
  using (tenant_id = public.current_tenant_id());
