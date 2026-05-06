// Renders the hardcoded safety caps from src/lib/live/safety-limits.ts.
// Used in three places:
//   1. /live page banner (always visible; red when mainnet active).
//   2. /settings/exchange connected state (red when network='mainnet').
//   3. Deploy wizard final step (informational; not gated by network).
//
// The panel reads describeSafetyLimits() so the values come straight
// from the constants module. There is intentionally no prop or
// context that lets a caller override the values - the panel is a
// view, the limits are code.

import { describeSafetyLimits } from '@/lib/live/safety-limits'

export type SafetyLimitsPanelProps = {
  // Visual emphasis. 'red' is used when a mainnet client is the
  // active routing target; 'amber' for testnet or pre-deployment
  // contexts.
  tone?: 'red' | 'amber' | 'neutral'
  // Title is overridable so the same panel works as the inline
  // "Active safety limits" banner on /live and as the final-step
  // copy in the deploy wizard.
  title?: string
  // When provided, shown above the limit grid as a one-line
  // explanation. Falls back to a default that reads cleanly in
  // every render context.
  subtitle?: string
}

export function SafetyLimitsPanel({
  tone = 'amber',
  title = 'Active safety limits',
  subtitle = 'Hardcoded in code. Cannot be changed without a redeploy.',
}: SafetyLimitsPanelProps) {
  const limits = describeSafetyLimits()
  const toneClass =
    tone === 'red'
      ? 'border-red-500/40 bg-red-500/[0.06]'
      : tone === 'amber'
        ? 'border-amber-500/30 bg-amber-500/[0.05]'
        : 'border-white/[0.06] bg-surface'
  const titleColour =
    tone === 'red'
      ? 'text-red-200'
      : tone === 'amber'
        ? 'text-amber-200'
        : 'text-white/85'

  return (
    <section className={`rounded-lg border p-4 sm:p-5 ${toneClass}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={`text-sm font-semibold ${titleColour}`}>{title}</h2>
        {tone === 'red' ? (
          <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-200">
            Mainnet
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] text-white/55">{subtitle}</p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {limits.map((l) => (
          <div
            key={l.label}
            className="rounded border border-white/[0.06] bg-bg/40 p-3"
          >
            <dt className="text-[10px] uppercase tracking-wider text-white/45">
              {l.label}
            </dt>
            <dd className="mt-1 font-mono text-sm text-white/90">{l.value}</dd>
            <p className="mt-1 text-[11px] text-white/55">{l.detail}</p>
          </div>
        ))}
      </dl>
    </section>
  )
}
