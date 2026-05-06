-- Strategy versioning.
--
-- Edits to a public.strategy_definitions row currently overwrite
-- the JSON in place. That is fine for drafts but dangerous once a
-- strategy is deployed: an operator who tweaks "the same" strategy
-- can no longer reproduce the version that produced past live
-- signals or backtest_runs.
--
-- This migration introduces:
--   * strategy_definitions.version_n        - monotonic counter,
--                                              bumped on every
--                                              definition update
--   * strategy_definition_versions          - immutable per-version
--                                              snapshot of name,
--                                              description and the
--                                              JSON document
--   * strategy_deployments.deployed_strategy_version
--                                            - the version_n of the
--                                              definition at deploy
--                                              time, so the live
--                                              page can call out
--                                              "deployed v3 of 7
--                                              available"
--
-- The snapshot is written by the application layer (server action)
-- to keep the rule visible in the codebase, rather than as a
-- Postgres trigger. The trigger approach was considered but rejected
-- because the version row needs the same tenant/user provenance the
-- application sees and surfacing trigger errors to the operator is
-- harder than handling them in the action.

alter table public.strategy_definitions
  add column if not exists version_n integer not null default 1;

create table public.strategy_definition_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  strategy_definition_id uuid not null
    references public.strategy_definitions(id) on delete cascade,
  version_n integer not null,
  name text not null,
  description text,
  definition jsonb not null,
  schema_version integer not null,
  -- Free-form change note the operator can attach to the version
  -- row. Optional; null is fine.
  change_note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint strategy_definition_versions_unique
    unique (strategy_definition_id, version_n)
);

create index strategy_definition_versions_tenant_idx
  on public.strategy_definition_versions
  (tenant_id, strategy_definition_id, version_n desc);

alter table public.strategy_definition_versions enable row level security;

create policy strategy_definition_versions_select
  on public.strategy_definition_versions
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy strategy_definition_versions_insert
  on public.strategy_definition_versions
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

-- Versions are intentionally immutable. No update / delete policy:
-- once written, a snapshot is referenced by deployments and child
-- backtest runs and rewriting history would be misleading.

alter table public.strategy_deployments
  add column if not exists deployed_strategy_version integer;

notify pgrst, 'reload schema';
