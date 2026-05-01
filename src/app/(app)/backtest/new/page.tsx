import { redirect } from 'next/navigation'

import { BacktestConfigForm } from '@/components/shared/BacktestConfigForm'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { createClient } from '@/lib/supabase/server'

export const metadata = {
  title: 'New backtest · Dizzy Trade',
}

export default async function NewBacktestPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  // Pre-fill the form from the live universe and the active strategy
  // (if any). The strategy lookup is best-effort; it only seeds
  // defaults so a missing or inactive strategy is not a hard error.
  const [universeRes, strategyRes] = await Promise.all([
    supabase
      .from('universe')
      .select('symbol')
      .eq('is_active', true)
      .order('symbol', { ascending: true }),
    supabase
      .from('strategies')
      .select(
        'framework_id, timeframe, pair_symbols, risk_amount_gbp, min_rr, max_concurrent_positions',
      )
      .eq('is_active', true)
      .limit(1),
  ])

  const pairUniverse = (universeRes.data ?? []).map((row) => row.symbol)
  const activeStrategy = strategyRes.data?.[0]

  return (
    <PageContainer>
      <PageHeader
        title="New backtest"
        subtitle="Configure the strategy, risk parameters, and date range, then run."
      />
      <BacktestConfigForm
        pairUniverse={pairUniverse}
        defaultPairs={activeStrategy?.pair_symbols}
        defaultFrameworkId={activeStrategy?.framework_id}
        defaultTimeframe={activeStrategy?.timeframe}
        defaultRiskAmountGbp={
          activeStrategy?.risk_amount_gbp != null
            ? Number(activeStrategy.risk_amount_gbp)
            : undefined
        }
        defaultMinRr={
          activeStrategy?.min_rr != null
            ? Number(activeStrategy.min_rr)
            : undefined
        }
        defaultMaxConcurrent={activeStrategy?.max_concurrent_positions}
      />
    </PageContainer>
  )
}
