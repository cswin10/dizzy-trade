import Link from 'next/link'
import { redirect } from 'next/navigation'

import { listAllStrategiesAction } from '@/app/actions/strategy-definitions'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { StrategyLibraryHeader } from '@/components/shared/StrategyLibraryHeader'
import { StrategyLibraryList } from '@/components/shared/StrategyLibraryList'
import { StrategyWorkspaceTabs } from '@/components/shared/StrategyWorkspaceTabs'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Strategies · Dizzy Trade',
}

export default async function StrategiesLibraryPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const result = await listAllStrategiesAction()
  const rows = result.ok ? result.rows : []

  return (
    <PageContainer>
      <PageHeader
        title="Strategies"
        subtitle="Composable JSON strategies and legacy frameworks. Activate one to run it on the next scanner tick."
        rightSlot={<StrategyLibraryHeader />}
      />
      <StrategyWorkspaceTabs active="library" />
      {!result.ok ? (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {result.message}
        </div>
      ) : null}
      <StrategyLibraryList rows={rows} />
      <p className="mt-6 text-xs text-white/45">
        Need to edit a legacy framework strategy?{' '}
        <Link
          href="/settings"
          className="text-accent transition-colors hover:underline"
        >
          Open the legacy editor in Settings
        </Link>
        .
      </p>
    </PageContainer>
  )
}
