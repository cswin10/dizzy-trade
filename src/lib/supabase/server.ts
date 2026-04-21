import {
  createServerClient as createSSRClient,
  type CookieOptions,
} from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

import { clientEnv } from '@/lib/env'
import type { Database } from '@/types/database'

// @supabase/ssr pins an internal import path that @supabase/supabase-js no
// longer ships, which makes its Schema generic collapse to `never` and
// breaks typed `.from()` and `.rpc()` calls. Cast to the supabase-js
// client shape, which is what the ssr helper returns at runtime anyway.
export function createClient(): SupabaseClient<Database> {
  const cookieStore = cookies()

  const client = createSSRClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(
          cookiesToSet: {
            name: string
            value: string
            options: CookieOptions
          }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Called from a Server Component, which cannot mutate cookies.
            // Safe to ignore because middleware refreshes the session cookie.
          }
        },
      },
    },
  )

  return client as unknown as SupabaseClient<Database>
}
