import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { StrategyBuilder } from '@/components/shared/StrategyBuilder'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'Build strategy · Dizzy Trade',
}

export default async function NewStrategyPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: universe } = await supabase
    .from('universe')
    .select('symbol')
    .eq('is_active', true)
    .order('symbol', { ascending: true })
  const pairUniverse = (universe ?? []).map((row) => row.symbol)

  return (
    <PageContainer>
      <PageHeader
        title="Build strategy"
        subtitle="Compose entry, exit, and sizing rules visually. The right column shows the live JSON document the engine will run."
      />
      <StrategyBuilder pairUniverse={pairUniverse} />
    </PageContainer>
  )
}
