import { redirect } from 'next/navigation'
import { type ReactNode } from 'react'

import { TopNav } from '@/components/shared/TopNav'
import { createClient } from '@/lib/supabase/server'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Middleware already gates this, but recheck defensively so a server
  // component can never render a page shell that leaks tenant data if the
  // middleware is ever misconfigured.
  if (!user) redirect('/sign-in')

  return (
    <div className="flex min-h-screen flex-col bg-navy">
      <TopNav userEmail={user.email ?? ''} />
      <div className="flex-1">{children}</div>
    </div>
  )
}
