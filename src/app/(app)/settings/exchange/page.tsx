import { redirect } from 'next/navigation'

import { PageContainer } from '@/components/shared/PageContainer'
import { PageHeader } from '@/components/shared/PageHeader'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Exchange · Dizzy Trade' }

// Phase 1 placeholder. Phase 2 will replace this with the actual
// API-wallet entry form, Vault encryption, and testnet / mainnet
// toggle. The route exists now so the navigation copy on /live can
// link to it without a broken-link footnote.
export default async function ExchangeSettingsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  return (
    <PageContainer>
      <PageHeader
        title="Exchange connection"
        subtitle="Hyperliquid API wallet and network settings."
      />
      <section className="rounded-lg border border-amber-500/30 bg-amber-500/[0.05] p-5">
        <h2 className="text-sm font-semibold text-amber-200">
          Phase 1 · using mock client
        </h2>
        <p className="mt-2 text-xs text-white/70">
          Live deployments currently route every order through an in-memory
          mock Hyperliquid client. No real exchange calls are made and no
          API wallet is required yet.
        </p>
        <p className="mt-2 text-xs text-white/70">
          Phase 2 ships the real client behind this page: paste an API wallet
          private key (never the main wallet&apos;s) and pick testnet or
          mainnet. The key is encrypted in Supabase Vault before it ever
          leaves the form.
        </p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-[11px] text-white/55">
          <li>Generate an API wallet on Hyperliquid (separate from your main wallet, signs orders only, cannot withdraw).</li>
          <li>Save the private key somewhere secure.</li>
          <li>Once Phase 2 ships, paste it here and pick testnet first.</li>
        </ul>
      </section>
    </PageContainer>
  )
}
