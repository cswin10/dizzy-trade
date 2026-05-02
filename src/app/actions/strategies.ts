'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  strategyInputSchema,
  type StrategyInput,
} from '@/lib/validations/strategy'

export type StrategyActionResult = {
  ok: boolean
  message?: string
  id?: string
}

async function requireUser(): Promise<boolean> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return Boolean(user)
}

function firstMessage(error: { errors?: { message: string }[] }): string {
  return error.errors?.[0]?.message ?? 'Invalid strategy input'
}

// Activating a strategy is two steps: deactivate any other active
// strategy (which would otherwise collide with the partial unique
// index strategies_one_active), then activate the target. The two
// updates are issued sequentially through the service-role client
// because supabase-js does not expose multi-statement transactions.
// In a single-operator deployment the small window where no strategy
// is active is acceptable; the next scan tick simply finds nothing
// to evaluate and exits cleanly.
async function deactivateOthers(
  service: ReturnType<typeof createServiceClient>,
  exceptId: string | null,
): Promise<{ ok: boolean; message?: string }> {
  const query = service
    .from('strategies')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('is_active', true)
  const { error } = exceptId ? await query.neq('id', exceptId) : await query
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

export async function createStrategyAction(
  input: StrategyInput,
): Promise<StrategyActionResult> {
  if (!(await requireUser())) {
    return { ok: false, message: 'Not authenticated' }
  }
  const parsed = strategyInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: firstMessage(parsed.error) }
  }

  const service = createServiceClient()
  // New strategies always start inactive so the operator can review
  // before flipping them on. Activating a fresh strategy goes through
  // toggleStrategyActiveAction.
  const { data, error } = await service
    .from('strategies')
    .insert({ ...parsed.data, is_active: false })
    .select('id')
    .single()
  if (error) return { ok: false, message: error.message }

  revalidatePath('/settings')
  return { ok: true, id: data?.id }
}

export async function updateStrategyAction(
  id: string,
  input: StrategyInput,
): Promise<StrategyActionResult> {
  if (!(await requireUser())) {
    return { ok: false, message: 'Not authenticated' }
  }
  const parsed = strategyInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: firstMessage(parsed.error) }
  }

  const service = createServiceClient()
  const { is_active, ...patch } = parsed.data
  // Activation flips are exclusively handled by toggleStrategyActiveAction
  // so we do not allow updateStrategyAction to introduce a second active
  // strategy by accident. is_active is dropped from the patch.
  void is_active
  const { error } = await service
    .from('strategies')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { ok: false, message: error.message }

  revalidatePath('/settings')
  return { ok: true, id }
}

export async function toggleStrategyActiveAction(
  id: string,
  active: boolean,
): Promise<StrategyActionResult> {
  if (!(await requireUser())) {
    return { ok: false, message: 'Not authenticated' }
  }
  if (!id) return { ok: false, message: 'Missing strategy id' }

  const service = createServiceClient()
  const nowIso = new Date().toISOString()

  if (!active) {
    const { error } = await service
      .from('strategies')
      .update({ is_active: false, updated_at: nowIso })
      .eq('id', id)
    if (error) return { ok: false, message: error.message }
    revalidatePath('/settings')
    return { ok: true, id }
  }

  const deactivated = await deactivateOthers(service, id)
  if (!deactivated.ok) return deactivated

  // Cross-table mutual exclusion: activating a legacy strategy
  // also deactivates any composable definition that is live, so
  // the scanner only ever sees one active source at a time.
  const { error: composableError } = await service
    .from('strategy_definitions')
    .update({ is_active: false, updated_at: nowIso })
    .eq('is_active', true)
  if (composableError) return { ok: false, message: composableError.message }

  const { error } = await service
    .from('strategies')
    .update({ is_active: true, updated_at: nowIso })
    .eq('id', id)
  if (error) return { ok: false, message: error.message }

  revalidatePath('/settings')
  return { ok: true, id }
}

export async function deleteStrategyAction(
  id: string,
): Promise<StrategyActionResult> {
  if (!(await requireUser())) {
    return { ok: false, message: 'Not authenticated' }
  }
  if (!id) return { ok: false, message: 'Missing strategy id' }

  const service = createServiceClient()
  // Block deletion if there are recent live alerts pointing at this
  // strategy; the operator has to dismiss them or wait the 30 days
  // out so we don't orphan history that's still actionable.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { count, error: countError } = await service
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .eq('strategy_id', id)
    .eq('dismissed', false)
    .gte('triggered_at', since)
  if (countError) return { ok: false, message: countError.message }
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message: `Cannot delete: ${count} live alert(s) in the last 30 days`,
    }
  }

  const { error } = await service.from('strategies').delete().eq('id', id)
  if (error) return { ok: false, message: error.message }

  revalidatePath('/settings')
  return { ok: true, id }
}
