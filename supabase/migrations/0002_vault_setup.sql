-- User secrets, backed by Supabase Vault.
--
-- v1 ships without any exchange integrations, so no user will actually store
-- a secret through this path yet. We wire up the plumbing now so that adding
-- Hyperliquid, Coinbase, Anthropic, or Alchemy integrations later is a matter
-- of calling the existing helper functions, not designing a secrets model
-- from scratch under time pressure.
--
-- Storage model
-- -------------
-- Encrypted bytes live in `vault.secrets`. The `public.user_secrets` table
-- never stores the secret itself, only a reference (`vault_secret_id`) and
-- a short, human-readable `masked_preview` like "sk_...abcd" that is safe to
-- render in the UI. RLS on `public.user_secrets` scopes rows to the caller's
-- tenant, but RLS cannot protect `vault.secrets` itself - decryption is only
-- allowed through the service role. The helper functions below are declared
-- `security definer` and are the only intended path for reading or writing
-- secret material. They are not granted to `authenticated`; they must be
-- called from server-side code holding the service role key.

create table public.user_secrets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  integration text not null check (
    integration in ('hyperliquid', 'coinbase', 'anthropic', 'alchemy')
  ),
  vault_secret_id uuid not null,
  masked_preview text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, integration)
);

create index user_secrets_tenant_idx on public.user_secrets (tenant_id);

alter table public.user_secrets enable row level security;

-- RLS policies gate access to the user_secrets metadata row only. They do
-- not and cannot gate access to vault.secrets, which is why decryption is
-- funneled through a security-definer function callable only by the
-- service role.
create policy user_secrets_select on public.user_secrets
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

create policy user_secrets_insert on public.user_secrets
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

create policy user_secrets_update on public.user_secrets
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy user_secrets_delete on public.user_secrets
  for delete
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- Create a vault entry and a matching user_secrets row in one transaction.
--
-- The caller's tenant is resolved from `current_tenant_id()` when no explicit
-- tenant is supplied, so this is safe to invoke from a server action running
-- as the end user. The service role path (scheduled jobs, admin tooling)
-- passes `p_tenant_id` explicitly because the service role has no
-- `auth.uid()`. The function is security definer so it can write into the
-- vault schema, which is not otherwise exposed to `authenticated`. Execute
-- privilege is granted only to the service role to keep a clear boundary:
-- client paths have no way to call this at all.
--
-- On conflict (same tenant + integration), the existing vault secret is
-- rotated and the user_secrets row is updated in place. That keeps the
-- mapping stable and avoids orphaned vault rows when a user re-submits.
create or replace function public.store_user_secret(
  p_integration text,
  p_secret text,
  p_masked_preview text,
  p_tenant_id uuid default null,
  p_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_tenant_id uuid;
  v_user_id uuid;
  v_vault_secret_id uuid;
  v_user_secret_id uuid;
  v_existing_vault_secret_id uuid;
begin
  v_tenant_id := coalesce(p_tenant_id, public.current_tenant_id());
  v_user_id := coalesce(p_user_id, auth.uid());

  if v_tenant_id is null then
    raise exception 'store_user_secret: no tenant resolved for caller';
  end if;

  if v_user_id is null then
    raise exception 'store_user_secret: no user resolved for caller';
  end if;

  select id, vault_secret_id
    into v_user_secret_id, v_existing_vault_secret_id
    from public.user_secrets
   where tenant_id = v_tenant_id
     and integration = p_integration;

  if v_user_secret_id is not null then
    perform vault.update_secret(
      v_existing_vault_secret_id,
      p_secret
    );

    update public.user_secrets
       set masked_preview = p_masked_preview,
           updated_at = now()
     where id = v_user_secret_id;

    return v_user_secret_id;
  end if;

  v_vault_secret_id := vault.create_secret(
    p_secret,
    'user_secret:' || v_tenant_id::text || ':' || p_integration,
    'User secret for tenant ' || v_tenant_id::text
      || ' integration ' || p_integration
  );

  insert into public.user_secrets (
    tenant_id, user_id, integration, vault_secret_id, masked_preview
  )
  values (
    v_tenant_id, v_user_id, p_integration, v_vault_secret_id, p_masked_preview
  )
  returning id into v_user_secret_id;

  return v_user_secret_id;
end;
$$;

-- Read the decrypted secret for the caller's tenant + integration.
--
-- Returns null if no secret is configured. `p_tenant_id` is optional: when
-- omitted, `current_tenant_id()` is used (user-session path); when provided,
-- the explicit value is used (service-role path, where `auth.uid()` is null).
-- The return value is sensitive and must never be logged, cached, or returned
-- to the browser. The TypeScript wrapper exposes it as an opaque
-- `DecryptedSecret` type to make misuse harder to write accidentally.
create or replace function public.get_user_secret(
  p_integration text,
  p_tenant_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_tenant_id uuid;
  v_vault_secret_id uuid;
  v_decrypted text;
begin
  v_tenant_id := coalesce(p_tenant_id, public.current_tenant_id());

  if v_tenant_id is null then
    raise exception 'get_user_secret: no tenant resolved for caller';
  end if;

  select vault_secret_id
    into v_vault_secret_id
    from public.user_secrets
   where tenant_id = v_tenant_id
     and integration = p_integration;

  if v_vault_secret_id is null then
    return null;
  end if;

  select decrypted_secret
    into v_decrypted
    from vault.decrypted_secrets
   where id = v_vault_secret_id;

  return v_decrypted;
end;
$$;

-- Remove the user_secrets row and the backing vault entry. `p_tenant_id` is
-- optional and follows the same user-session vs service-role convention as
-- the other helpers.
create or replace function public.delete_user_secret(
  p_integration text,
  p_tenant_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_tenant_id uuid;
  v_vault_secret_id uuid;
begin
  v_tenant_id := coalesce(p_tenant_id, public.current_tenant_id());

  if v_tenant_id is null then
    raise exception 'delete_user_secret: no tenant resolved for caller';
  end if;

  select vault_secret_id
    into v_vault_secret_id
    from public.user_secrets
   where tenant_id = v_tenant_id
     and integration = p_integration;

  if v_vault_secret_id is null then
    return;
  end if;

  delete from public.user_secrets
   where tenant_id = v_tenant_id
     and integration = p_integration;

  delete from vault.secrets where id = v_vault_secret_id;
end;
$$;

-- Lock down execute privileges. The helpers are security definer and touch
-- vault internals, so we only let the service role call them. The anon and
-- authenticated roles never get a path to decryption.
revoke execute on function
  public.store_user_secret(text, text, text, uuid, uuid) from public;
revoke execute on function
  public.get_user_secret(text, uuid) from public;
revoke execute on function
  public.delete_user_secret(text, uuid) from public;

grant execute on function
  public.store_user_secret(text, text, text, uuid, uuid) to service_role;
grant execute on function
  public.get_user_secret(text, uuid) to service_role;
grant execute on function
  public.delete_user_secret(text, uuid) to service_role;
