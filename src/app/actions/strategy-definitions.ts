'use server'

import { revalidatePath } from 'next/cache'

import {
  tryValidateStrategyDefinition,
  validateStrategyDefinition,
} from '@/lib/strategies/schema'
import type { StrategyDefinition } from '@/lib/strategies/types'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export type StrategyDefinitionRow = {
  id: string
  tenant_id: string
  name: string
  description: string | null
  definition: StrategyDefinition
  schema_version: number
  is_archived: boolean
  created_at: string | null
  updated_at: string | null
}

export type StrategyDefinitionActionResult =
  | { ok: true; row: StrategyDefinitionRow }
  | { ok: false; message: string }

export type StrategyDefinitionListResult =
  | { ok: true; rows: StrategyDefinitionRow[] }
  | { ok: false; message: string }

export type StrategyJsonValidationResult =
  | { ok: true; parsed: StrategyDefinition }
  | { ok: false; errors: string[] }

async function resolveTenant() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Not authenticated' }
  const { data: memberships, error } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
  if (error) return { ok: false as const, error: error.message }
  const tenantId = memberships?.[0]?.tenant_id
  if (!tenantId) return { ok: false as const, error: 'No tenant for user' }
  return { ok: true as const, user, tenantId }
}

function rowToDomain(row: {
  id: string
  tenant_id: string
  name: string
  description: string | null
  definition: Record<string, unknown>
  schema_version: number
  is_archived: boolean
  created_at: string | null
  updated_at: string | null
}): StrategyDefinitionRow {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    description: row.description,
    // The stored definition was validated on the way in, so cast.
    // If the schema version ever changes, the validator stays
    // backwards-compatible or the migration upgrades the rows.
    definition: row.definition as unknown as StrategyDefinition,
    schema_version: row.schema_version,
    is_archived: row.is_archived,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function createStrategyDefinitionAction(
  name: string,
  description: string | null,
  definitionJson: unknown,
): Promise<StrategyDefinitionActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  let parsed: StrategyDefinition
  try {
    parsed = validateStrategyDefinition(definitionJson)
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }

  // Sync the top-level name with the definition's name when the
  // caller did not supply one. This keeps the row's listing label
  // in sync with the JSON document by default.
  const finalName = name.trim().length > 0 ? name.trim() : parsed.name

  const service = createServiceClient()
  const { data, error } = await service
    .from('strategy_definitions')
    .insert({
      tenant_id: ctx.tenantId,
      name: finalName,
      description: description ?? null,
      definition: parsed as unknown as Record<string, unknown>,
      schema_version: parsed.schema_version,
      is_archived: false,
    })
    .select('*')
    .single()
  if (error || !data) {
    return { ok: false, message: error?.message ?? 'Insert failed' }
  }

  revalidatePath('/settings')
  return { ok: true, row: rowToDomain(data) }
}

export async function updateStrategyDefinitionAction(
  id: string,
  patch: {
    name?: string
    description?: string | null
    definitionJson?: unknown
  },
): Promise<StrategyDefinitionActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const service = createServiceClient()

  // Ownership check up front so we never even prepare an update
  // payload for a row that does not belong to the caller's tenant.
  const { data: existing, error: lookupError } = await service
    .from('strategy_definitions')
    .select('id, tenant_id')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .single()
  if (lookupError || !existing) {
    return {
      ok: false,
      message: lookupError?.message ?? 'Strategy definition not found',
    }
  }

  const update: {
    name?: string
    description?: string | null
    definition?: Record<string, unknown>
    schema_version?: number
    updated_at: string
  } = { updated_at: new Date().toISOString() }

  if (patch.name !== undefined) update.name = patch.name.trim()
  if (patch.description !== undefined) update.description = patch.description
  if (patch.definitionJson !== undefined) {
    let parsed: StrategyDefinition
    try {
      parsed = validateStrategyDefinition(patch.definitionJson)
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
    update.definition = parsed as unknown as Record<string, unknown>
    update.schema_version = parsed.schema_version
  }

  const { data, error } = await service
    .from('strategy_definitions')
    .update(update)
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .select('*')
    .single()
  if (error || !data) {
    return { ok: false, message: error?.message ?? 'Update failed' }
  }

  revalidatePath('/settings')
  return { ok: true, row: rowToDomain(data) }
}

export async function archiveStrategyDefinitionAction(
  id: string,
): Promise<StrategyDefinitionActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const service = createServiceClient()
  const { data, error } = await service
    .from('strategy_definitions')
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .select('*')
    .single()
  if (error || !data) {
    return { ok: false, message: error?.message ?? 'Archive failed' }
  }

  revalidatePath('/settings')
  return { ok: true, row: rowToDomain(data) }
}

export async function deleteStrategyDefinitionAction(
  id: string,
): Promise<{ ok: boolean; message?: string }> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const service = createServiceClient()
  const { error } = await service
    .from('strategy_definitions')
    .delete()
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
  if (error) return { ok: false, message: error.message }

  revalidatePath('/settings')
  return { ok: true }
}

export async function getStrategyDefinitionAction(
  id: string,
): Promise<StrategyDefinitionActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const service = createServiceClient()
  const { data, error } = await service
    .from('strategy_definitions')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .single()
  if (error || !data) {
    return {
      ok: false,
      message: error?.message ?? 'Strategy definition not found',
    }
  }
  return { ok: true, row: rowToDomain(data) }
}

export async function listStrategyDefinitionsAction(
  includeArchived = false,
): Promise<StrategyDefinitionListResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const service = createServiceClient()
  let query = service
    .from('strategy_definitions')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false })
  if (!includeArchived) {
    query = query.eq('is_archived', false)
  }
  const { data, error } = await query
  if (error) return { ok: false, message: error.message }
  return { ok: true, rows: (data ?? []).map(rowToDomain) }
}

// Pure validation entry point used by the (forthcoming) composer
// UI to check JSON before the user commits a save. Auth-gated so
// random unauthenticated callers cannot use it as a free zod
// service, but does not require a tenant: validation is stateless.
export async function validateStrategyJsonAction(
  jsonText: string,
): Promise<StrategyJsonValidationResult> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, errors: ['Not authenticated'] }

  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch (error) {
    return {
      ok: false,
      errors: [
        error instanceof Error
          ? `JSON parse error: ${error.message}`
          : 'JSON parse error',
      ],
    }
  }

  return tryValidateStrategyDefinition(raw)
}
