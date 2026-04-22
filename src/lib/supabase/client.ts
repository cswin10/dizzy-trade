import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

import { clientEnv } from '@/lib/env'
import type { Database } from '@/types/database'

// See server.ts for the rationale: @supabase/ssr's internal type path
// drift breaks typed `.from()` and `.rpc()` calls. Cast through to the
// supabase-js client shape, which is what the helper returns at runtime.
export function createClient(): SupabaseClient<Database> {
  const client = createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
  return client as unknown as SupabaseClient<Database>
}
