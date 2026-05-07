// Route-level loading skeleton. Next.js shows this immediately on
// navigation, before the server render completes, so a slow page
// fetch no longer leaves the previous screen frozen with no
// feedback. The shell mirrors PageContainer + PageHeader so the
// transition feels like content settling in rather than a full
// re-paint.

import { PageContainer } from '@/components/shared/PageContainer'

export default function AppLoading() {
  return (
    <PageContainer>
      <header className="mb-6 flex flex-col gap-3 border-b border-white/[0.04] pb-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between sm:gap-4 sm:pb-5">
        <div className="flex flex-col gap-2">
          <div className="h-7 w-48 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-4 w-72 animate-pulse rounded bg-white/[0.04]" />
        </div>
      </header>
      <div className="flex flex-col gap-3">
        <div className="h-32 w-full animate-pulse rounded-lg border border-white/[0.04] bg-white/[0.02]" />
        <div className="h-32 w-full animate-pulse rounded-lg border border-white/[0.04] bg-white/[0.02]" />
      </div>
    </PageContainer>
  )
}
