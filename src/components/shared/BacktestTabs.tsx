import Link from 'next/link'

import { twMerge } from 'tailwind-merge'

export type BacktestTabsProps = {
  active: 'runs' | 'sweeps'
}

const TABS: Array<{ key: 'runs' | 'sweeps'; label: string; href: string }> = [
  { key: 'runs', label: 'Runs', href: '/backtest' },
  { key: 'sweeps', label: 'Sweeps', href: '/backtest/sweeps' },
]

// Underline-style tabs above the runs and sweeps lists. Server
// component because the active tab is encoded in the URL, not held
// as client state, so the parent page just tells us which one is
// active.
export function BacktestTabs({ active }: BacktestTabsProps) {
  return (
    <div className="flex items-center gap-6 border-b border-white/[0.06]">
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
