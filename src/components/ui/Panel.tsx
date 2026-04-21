import { type ReactNode } from 'react'

import { twMerge } from 'tailwind-merge'

export type PanelProps = {
  title?: string
  headerRight?: ReactNode
  className?: string
  bodyClassName?: string
  children?: ReactNode
}

export function Panel({
  title,
  headerRight,
  className,
  bodyClassName,
  children,
}: PanelProps) {
  return (
    <section
      className={twMerge(
        'flex flex-col rounded-sm border border-light/10 bg-navy-deep',
        className,
      )}
    >
      {title || headerRight ? (
        <header className="flex items-center justify-between border-b border-light/10 px-5 py-3">
          {title ? (
            <h2 className="text-[11px] font-medium uppercase tracking-widest text-light/60">
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
      <div className={twMerge('p-6', bodyClassName)}>{children}</div>
    </section>
  )
}
