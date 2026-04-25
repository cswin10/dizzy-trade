'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export type UserPreferences = {
  analytics_layout: string[] | null
}

const EMPTY_PREFERENCES: UserPreferences = {
  analytics_layout: null,
}

async function resolveTenantId(): Promise<string | null> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: memberships } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
  return memberships?.[0]?.tenant_id ?? null
}

export async function getUserPreferences(): Promise<UserPreferences> {
  const tenantId = await resolveTenantId()
  if (!tenantId) return EMPTY_PREFERENCES

  const service = createServiceClient()
  const { data, error } = await service
    .from('user_preferences')
    .select('analytics_layout')
    .eq('tenant_id', tenantId)
    .limit(1)
  if (error) {
    console.warn(`[preferences] load failed: ${error.message}`)
    return EMPTY_PREFERENCES
  }
  const row = data?.[0]
  if (!row) return EMPTY_PREFERENCES
  const layout = Array.isArray(row.analytics_layout)
    ? (row.analytics_layout as unknown[]).filter(
        (v): v is string => typeof v === 'string',
      )
    : null
  return { analytics_layout: layout }
}

export type SaveLayoutResult = { ok: boolean; message?: string }

/**
 * Upserts the analytics layout for the user's tenant. Layout is an
 * ordered list of panel ids. The page-side validator filters out
 * unknown ids and appends missing ones, so we accept any string array
 * here without strict checks.
 */
export async function saveAnalyticsLayout(
  layout: string[],
): Promise<SaveLayoutResult> {
  const tenantId = await resolveTenantId()
  if (!tenantId) return { ok: false, message: 'Not authenticated' }

  if (!Array.isArray(layout)) {
    return { ok: false, message: 'Layout must be an array' }
  }
  const cleanLayout = layout.filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  )

  const service = createServiceClient()
  const { error } = await service.from('user_preferences').upsert(
    {
      tenant_id: tenantId,
      analytics_layout: cleanLayout,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id' },
  )
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
