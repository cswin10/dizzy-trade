import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import type { Trade } from '@/lib/trade-helpers'

type Client = SupabaseClient<Database>

// Subscribes to all INSERT, UPDATE, DELETE events on the trades table for
// the given tenant. RLS already restricts the postgres-level visibility,
// the explicit `filter` adds belt-and-braces in case the channel is
// reused. The caller is responsible for invoking `removeChannel` on the
// returned channel when the subscription should end.
export function subscribeToTrades(
  client: Client,
  tenantId: string,
  handler: (event: RealtimePostgresChangesPayload<Trade>) => void,
): RealtimeChannel {
  const channel = client
    .channel(`trades-${tenantId}`)
    .on<Trade>(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'trades',
        filter: `tenant_id=eq.${tenantId}`,
      },
      handler,
    )
    .subscribe()

  return channel
}
