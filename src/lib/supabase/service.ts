// NEVER import this into a client component or any code path reachable from
// user input without explicit authorisation checks. The service role key
// bypasses row-level security and has full access to the database.
import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

import { clientEnv, env } from '@/lib/env'
import type { Database } from '@/types/database'

export function createServiceClient() {
  return createSupabaseClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )
}
