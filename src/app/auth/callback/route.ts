import { NextResponse, type NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')

  if (code) {
    const supabase = createClient()
    await supabase.auth.exchangeCodeForSession(code)
  }

  // Always land on /sign-in after a confirmation. If the exchange produced
  // a valid session, middleware will forward the user onward to /dashboard
  // on the next request. If it did not, they can sign in with the
  // credentials they just confirmed.
  return NextResponse.redirect(new URL('/sign-in', url.origin))
}
