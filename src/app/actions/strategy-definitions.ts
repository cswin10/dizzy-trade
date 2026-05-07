'use server'

// Side-effect import: populates the strategy condition and exit-
// rule registries at module load. Without this, validate/evaluate
// would only know about the four built-in rule schemas registered
// inside schema.ts and would reject anything from the condition
// library.
import '@/lib/strategies/register'

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
  version_n: number
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
  version_n?: number | null
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
    version_n: row.version_n ?? 1,
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
      version_n: 1,
    })
    .select('*')
    .single()
  if (error || !data) {
    return { ok: false, message: error?.message ?? 'Insert failed' }
  }

  // Write the v1 snapshot so the version history is complete from
  // day one. A failure here is logged but does not roll back the
  // definition: a missing v1 row only impairs the history view.
  const { error: versionError } = await service
    .from('strategy_definition_versions')
    .insert({
      tenant_id: ctx.tenantId,
      strategy_definition_id: data.id,
      version_n: 1,
      name: finalName,
      description: description ?? null,
      definition: parsed as unknown as Record<string, unknown>,
      schema_version: parsed.schema_version,
      change_note: 'Initial version',
      created_by: ctx.user.id,
    })
  if (versionError) {
    console.warn(
      `[strategy-definitions] v1 snapshot insert failed for ${data.id}: ${versionError.message}`,
    )
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
    change_note?: string | null
  },
): Promise<StrategyDefinitionActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const service = createServiceClient()

  // Ownership check up front so we never even prepare an update
  // payload for a row that does not belong to the caller's tenant.
  // We also fetch version_n + the current name/description/definition
  // so we can write a snapshot row before persisting the new
  // version.
  const { data: existing, error: lookupError } = await service
    .from('strategy_definitions')
    .select('id, tenant_id, name, description, definition, schema_version, version_n')
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
    version_n?: number
    updated_at: string
  } = { updated_at: new Date().toISOString() }

  if (patch.name !== undefined) update.name = patch.name.trim()
  if (patch.description !== undefined) update.description = patch.description

  // Only bump version_n + write a snapshot when the JSON document
  // actually changed. Pure name/description edits are tracked via
  // updated_at but do not deserve a new version row.
  let nextVersion = existing.version_n ?? 1
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
    nextVersion = (existing.version_n ?? 1) + 1
    update.version_n = nextVersion
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

  // Snapshot the new version after the row write succeeds. Same
  // approach as create: a snapshot failure logs but does not undo
  // the update.
  if (patch.definitionJson !== undefined) {
    const { error: versionError } = await service
      .from('strategy_definition_versions')
      .insert({
        tenant_id: ctx.tenantId,
        strategy_definition_id: id,
        version_n: nextVersion,
        name: data.name,
        description: data.description,
        definition: data.definition,
        schema_version: data.schema_version,
        change_note: patch.change_note ?? null,
        created_by: ctx.user.id,
      })
    if (versionError) {
      console.warn(
        `[strategy-definitions] v${nextVersion} snapshot insert failed for ${id}: ${versionError.message}`,
      )
    }
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

// Cross-table activation. Composable and legacy strategies share
// the "single active" invariant: at most one row across both
// tables for a tenant should be active at once. We enforce this
// by deactivating every legacy row plus every other composable
// row before flipping the target on. The three writes are
// sequential (supabase-js does not expose multi-statement
// transactions); the worst case is a brief window where no
// strategy is active, which the scanner handles by skipping the
// tick. The Postgres partial unique index on strategy_definitions
// catches a concurrent activation racing against this one.
export async function activateStrategyDefinitionAction(
  id: string,
): Promise<StrategyDefinitionActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const service = createServiceClient()
  const nowIso = new Date().toISOString()

  // 1. Deactivate every active legacy strategy. The legacy table
  // has no tenant_id (single-trader v1) so this scopes globally.
  const { error: legacyError } = await service
    .from('strategies')
    .update({ deployment_status: 'paused', updated_at: nowIso })
    .eq('deployment_status', 'live')
  if (legacyError) return { ok: false, message: legacyError.message }

  // 2. Deactivate every other composable strategy in this tenant.
  const { error: compError } = await service
    .from('strategy_definitions')
    .update({ deployment_status: 'paused', updated_at: nowIso })
    .eq('tenant_id', ctx.tenantId)
    .neq('id', id)
  if (compError) return { ok: false, message: compError.message }

  // 3. Activate the target.
  const { data, error } = await service
    .from('strategy_definitions')
    .update({ deployment_status: 'live', updated_at: nowIso })
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .select('*')
    .single()
  if (error || !data) {
    return { ok: false, message: error?.message ?? 'Activation failed' }
  }

  revalidatePath('/settings')
  return { ok: true, row: rowToDomain(data) }
}

export async function deactivateStrategyDefinitionAction(
  id: string,
): Promise<StrategyDefinitionActionResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const service = createServiceClient()
  const { data, error } = await service
    .from('strategy_definitions')
    .update({ deployment_status: 'paused', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .select('*')
    .single()
  if (error || !data) {
    return { ok: false, message: error?.message ?? 'Deactivation failed' }
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

export type StrategyDefinitionVersionRow = {
  id: string
  strategy_definition_id: string
  version_n: number
  name: string
  description: string | null
  definition: StrategyDefinition
  schema_version: number
  change_note: string | null
  created_by: string | null
  created_at: string
}

export type StrategyDefinitionVersionsResult =
  | { ok: true; rows: StrategyDefinitionVersionRow[] }
  | { ok: false; message: string }

export async function listStrategyDefinitionVersionsAction(
  strategyDefinitionId: string,
): Promise<StrategyDefinitionVersionsResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const service = createServiceClient()
  const { data, error } = await service
    .from('strategy_definition_versions')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('strategy_definition_id', strategyDefinitionId)
    .order('version_n', { ascending: false })
  if (error) return { ok: false, message: error.message }
  const rows: StrategyDefinitionVersionRow[] = (data ?? []).map((r) => ({
    id: r.id,
    strategy_definition_id: r.strategy_definition_id,
    version_n: r.version_n,
    name: r.name,
    description: r.description,
    definition: r.definition as unknown as StrategyDefinition,
    schema_version: r.schema_version,
    change_note: r.change_note,
    created_by: r.created_by,
    created_at: r.created_at,
  }))
  return { ok: true, rows }
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

// --- Unified library helpers ------------------------------------

export type StrategyLibraryRow = {
  source: 'composable' | 'framework'
  id: string
  name: string
  description: string | null
  // Mirrors the deployment_status column. Kept as a derived
  // boolean for callers that only care whether the row is live;
  // deployment_status itself is also surfaced for callers that
  // need to differentiate draft / paused / archived.
  is_active: boolean
  deployment_status: 'draft' | 'live' | 'paused' | 'archived'
  is_archived: boolean
  pairs: string[]
  timeframe: string
  created_at: string | null
  updated_at: string | null
  // Composable-only.
  definition: StrategyDefinition | null
  // Framework-only.
  framework_id: string | null
}

export type StrategyLibraryListResult =
  | { ok: true; rows: StrategyLibraryRow[] }
  | { ok: false; message: string }

// Unified listing for the new Strategies library page. Pulls
// composable strategy_definitions and the legacy strategies
// table and merges them on a single shape so the UI can render
// one list with a source pill per row.
export async function listAllStrategiesAction(): Promise<StrategyLibraryListResult> {
  const ctx = await resolveTenant()
  if (!ctx.ok) return { ok: false, message: ctx.error }

  const service = createServiceClient()
  const [composableRes, legacyRes] = await Promise.all([
    service
      .from('strategy_definitions')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .order('updated_at', { ascending: false }),
    service
      .from('strategies')
      .select(
        'id, name, framework_id, timeframe, pair_symbols, deployment_status, created_at, updated_at',
      )
      .order('updated_at', { ascending: false }),
  ])

  if (composableRes.error) {
    return { ok: false, message: composableRes.error.message }
  }
  if (legacyRes.error) {
    return { ok: false, message: legacyRes.error.message }
  }

  const composable: StrategyLibraryRow[] = (composableRes.data ?? []).map(
    (row) => ({
      source: 'composable',
      id: row.id,
      name: row.name,
      description: row.description,
      is_active: row.deployment_status === 'live',
      deployment_status: row.deployment_status,
      is_archived: row.is_archived,
      pairs: row.pairs ?? [],
      timeframe: row.timeframe,
      created_at: row.created_at,
      updated_at: row.updated_at,
      definition: row.definition as unknown as StrategyDefinition,
      framework_id: null,
    }),
  )
  const legacy: StrategyLibraryRow[] = (legacyRes.data ?? []).map((row) => ({
    source: 'framework',
    id: row.id,
    name: row.name,
    description: null,
    is_active: row.deployment_status === 'live',
    deployment_status: row.deployment_status,
    is_archived: false,
    pairs: row.pair_symbols ?? [],
    timeframe: row.timeframe,
    created_at: row.created_at,
    updated_at: row.updated_at,
    definition: null,
    framework_id: row.framework_id,
  }))
  // Active row first, then most-recently updated.
  const merged = [...composable, ...legacy].sort((a, b) => {
    if (a.is_active && !b.is_active) return -1
    if (!a.is_active && b.is_active) return 1
    const at = a.updated_at ? Date.parse(a.updated_at) : 0
    const bt = b.updated_at ? Date.parse(b.updated_at) : 0
    return bt - at
  })
  return { ok: true, rows: merged }
}
