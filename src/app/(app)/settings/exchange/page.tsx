import { redirect } from 'next/navigation'

import { getExchangeStatusAction } from '@/app/actions/exchange-credentials'
import { ExchangeConnectionForm } from '@/components/shared/ExchangeConnectionForm'
import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Exchange · Dizzy Trade' }

export default async function ExchangeSettingsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const status = await getExchangeStatusAction()

  return (
    <PageContainer>
      <PageHeader
        title="Exchange connection"
        subtitle="Hyperliquid API wallet and network settings."
      />
      <ExchangeConnectionForm initialStatus={status} />

      <section className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-amber-200">
          Testnet mode
        </h2>
        <p className="mt-2 text-xs text-white/70">
          Phase 2a places real orders on Hyperliquid testnet. No mainnet
          funds are at risk and the factory rejects mainnet credentials at
          two layers (here and in the exchange selector). Phase 2c will
          enable mainnet behind an additional opt-in.
        </p>
      </section>
    </PageContainer>
  )
}
