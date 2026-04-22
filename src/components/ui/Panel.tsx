import { type ReactNode } from 'react'

import { twMerge } from 'tailwind-merge'

export type PanelProps = {
  title?: string
  headerRight?: ReactNode
  interactive?: boolean
  className?: string
  bodyClassName?: string
  children?: ReactNode
}

export function Panel({
  title,
  headerRight,
  interactive = false,
  className,
  bodyClassName,
  children,
}: PanelProps) {
  return (
    <section
      className={twMerge(
        'rounded-lg border border-white/[0.06] bg-surface bg-panel-lit',
        'transition-colors duration-200',
        interactive &&
          'cursor-pointer hover:border-white/10 hover:bg-surface-2',
        !interactive && 'hover:border-white/10 hover:bg-surface-2',
        className,
      )}
    >
      {title || headerRight ? (
        <header className="flex items-center justify-between px-5 pb-0 pt-4">
          {title ? (
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-white/55">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {headerRight ? (
            <div className="flex items-center gap-3">{headerRight}</div>
          ) : null}
        </header>
      ) : null}
      <div className={twMerge('px-5 py-4', bodyClassName)}>{children}</div>
    </section>
  )
}
