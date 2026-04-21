-- Defence in depth on top of migration 0002.
--
-- Migration 0002 already restricts execute privilege on the three Vault
-- helpers to `service_role` via the grant/revoke statements at the bottom
-- of that file. That is the primary control. This migration adds a
-- secondary control inside each function body so that if those privileges
-- are ever loosened, whether by a future migration, a manual grant run in
-- production debugging, or a misconfigured role, an authenticated caller
-- still cannot pass an arbitrary `p_tenant_id` and read or mutate another
-- tenant's secrets.
--
-- The rule is simple: only the service role may supply `p_tenant_id`
-- explicitly. Every other caller must resolve tenant via
-- `current_tenant_id()`, which reads `auth.uid()` and is therefore pinned
-- to whoever is logged in. `auth.role()` reflects the database role on
-- the connection, so checking it inside a security definer function still
-- reports the caller's role rather than the definer's.
--
-- The rest of each function body is copied unchanged from 0002. Grants
-- and revokes are not touched.

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
  if p_tenant_id is not null and auth.role() <> 'service_role' then
    raise exception 'store_user_secret: explicit tenant_id only allowed for service role';
  end if;

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
  if p_tenant_id is not null and auth.role() <> 'service_role' then
    raise exception 'get_user_secret: explicit tenant_id only allowed for service role';
  end if;

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
  if p_tenant_id is not null and auth.role() <> 'service_role' then
    raise exception 'delete_user_secret: explicit tenant_id only allowed for service role';
  end if;

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
