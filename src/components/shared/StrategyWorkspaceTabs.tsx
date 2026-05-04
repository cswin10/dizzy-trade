import Link from 'next/link'

import { twMerge } from 'tailwind-merge'

export type StrategyWorkspaceTabsProps = {
  active: 'library' | 'backtest' | 'live' | 'analytics'
}

const TABS: Array<{
  key: StrategyWorkspaceTabsProps['active']
  label: string
  href: string
}> = [
  { key: 'library', label: 'Library', href: '/settings/strategies' },
  { key: 'backtest', label: 'Backtest', href: '/backtest' },
  { key: 'live', label: 'Live', href: '/live' },
  { key: 'analytics', label: 'Analytics', href: '/analytics' },
]

// Underline-style sub-nav inside the strategy workspace. Routes
// stay flat (/settings/strategies, /backtest, /live, /analytics);
// this component is purely a UI consolidation that lets the
// operator move between the four workspace sections without
// going back up to the top nav. Server component because the
// active tab is always derivable from the URL, not from client
// state - the parent page tells us which one it is.
export function StrategyWorkspaceTabs({
  active,
}: StrategyWorkspaceTabsProps) {
  return (
    <div className="mb-6 flex items-center gap-6 border-b border-white/[0.06]">
      {TABS.map((tab) => {
        const isActive = tab.key === active
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={twMerge(
              'relative -mb-px py-2 text-sm font-medium transition-colors duration-200',
              isActive ? 'text-white' : 'text-white/55 hover:text-white',
            )}
          >
            {tab.label}
            {isActive ? (
              <span
                aria-hidden
                className="absolute inset-x-0 -bottom-[1px] h-px bg-accent"
              />
            ) : null}
          </Link>
        )
      })}
    </div>
  )
}
