import { NextResponse, type NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'

async function handle(request: NextRequest) {
  const supabase = createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/sign-in', request.url))
}

export const GET = handle
export const POST = handle
