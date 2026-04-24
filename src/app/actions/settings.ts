'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export type SettingsActionResult = {
  ok: boolean
  message?: string
}

// Thresholds and narrative tags are global config, but writing still
// requires an authenticated session. Service role is used for the
// actual update so we don't have to widen RLS on what are reference
// tables. Any logged-in user in this single-tenant build is an operator.
async function requireUser(): Promise<boolean> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return Boolean(user)
}

const thresholdSchema = z.object({
  framework_id: z.string().min(1),
  key: z.string().min(1),
  value: z.number().finite(),
})

export async function updateThresholdAction(
  framework_id: string,
  key: string,
  value: number,
): Promise<SettingsActionResult> {
  const parsed = thresholdSchema.safeParse({ framework_id, key, value })
  if (!parsed.success) {
    return { ok: false, message: 'Invalid threshold update' }
  }
  if (!(await requireUser())) {
    return { ok: false, message: 'Not authenticated' }
  }

  const service = createServiceClient()
  const { error } = await service
    .from('framework_thresholds')
    .update({ value: parsed.data.value, updated_at: new Date().toISOString() })
    .eq('framework_id', parsed.data.framework_id)
    .eq('key', parsed.data.key)

  if (error) return { ok: false, message: error.message }

  revalidatePath('/settings')
  return { ok: true }
}

const HEAT_LEVELS = ['hot', 'warm', 'cool', 'cold'] as const
const narrativeSchema = z.object({
  symbol: z.string().min(1).max(32),
  heat_level: z.enum(HEAT_LEVELS),
  note: z.string().max(500).optional(),
})

export async function updateNarrativeTagAction(
  symbol: string,
  heat_level: string,
  note?: string,
): Promise<SettingsActionResult> {
  const parsed = narrativeSchema.safeParse({ symbol, heat_level, note })
  if (!parsed.success) {
    return { ok: false, message: 'Invalid narrative update' }
  }
  if (!(await requireUser())) {
    return { ok: false, message: 'Not authenticated' }
  }

  const service = createServiceClient()
  const { error } = await service.from('narrative_tags').upsert(
    {
      symbol: parsed.data.symbol,
      heat_level: parsed.data.heat_level,
      note: parsed.data.note ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'symbol' },
  )

  if (error) return { ok: false, message: error.message }

  revalidatePath('/settings')
  return { ok: true }
}
