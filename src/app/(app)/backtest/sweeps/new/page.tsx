import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { SweepConfigForm } from '@/components/shared/SweepConfigForm'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'New sweep · Dizzy Trade',
}

export default async function NewSweepPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const [universeRes, strategyRes] = await Promise.all([
    supabase
      .from('universe')
      .select('symbol')
      .eq('is_active', true)
      .order('symbol', { ascending: true }),
    supabase
      .from('strategies')
      .select('framework_id, timeframe, pair_symbols')
      .eq('is_active', true)
      .limit(1),
  ])

  const pairUniverse = (universeRes.data ?? []).map((row) => row.symbol)
  const activeStrategy = strategyRes.data?.[0]

  return (
    <PageContainer>
      <PageHeader
        title="New parameter sweep"
        subtitle="Vary thresholds and risk parameters across a range of values, run all combinations, and compare results."
      />
      <SweepConfigForm
        pairUniverse={pairUniverse}
        defaultPairs={activeStrategy?.pair_symbols}
        defaultFrameworkId={activeStrategy?.framework_id}
        defaultTimeframe={activeStrategy?.timeframe}
      />
    </PageContainer>
  )
}
