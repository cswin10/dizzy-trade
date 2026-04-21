import { NextResponse, type NextRequest } from 'next/server'

import { updateSession } from '@/lib/supabase/middleware'

// Routes that unauthenticated users are allowed to see. Everything else
// redirects to /sign-in. The landing page at `/` is public so that a
// logged-out visitor sees something other than a redirect loop; the app
// shell lives behind /dashboard and friends.
const PUBLIC_ROUTES = new Set(['/', '/sign-in', '/sign-up'])

// Routes an authenticated user should never see. We forward them on to the
// dashboard instead of rendering the auth forms.
const AUTH_ROUTES = new Set(['/sign-in', '/sign-up'])

export async function middleware(request: NextRequest) {
  const { response, userId } = await updateSession(request)
  const path = request.nextUrl.pathname

  // Supabase auth callback and sign-out must always reach their handlers,
  // regardless of session state. The callback runs whilst we are still
  // mid-confirmation and sign-out is what clears a stale session.
  if (path.startsWith('/auth/callback') || path === '/sign-out') {
    return response
  }

  if (userId && AUTH_ROUTES.has(path)) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  if (!userId && !PUBLIC_ROUTES.has(path)) {
    return NextResponse.redirect(new URL('/sign-in', request.url))
  }

  return response
}

export const config = {
  matcher: [
    // Run on everything except Next internals, the favicon, and common
    // static asset extensions.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff|woff2|ttf|eot)$).*)',
  ],
}
