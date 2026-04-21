import { type ReactNode } from 'react'

export type PageHeaderProps = {
  title: string
  subtitle?: string
  rightSlot?: ReactNode
}

export function PageHeader({ title, subtitle, rightSlot }: PageHeaderProps) {
  return (
    <header className="mb-8 flex items-end justify-between gap-4 border-b border-light/10 pb-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-sm font-medium uppercase tracking-widest text-light">
          {title}
        </h1>
        {subtitle ? <p className="text-xs text-light/40">{subtitle}</p> : null}
      </div>
      {rightSlot ? (
        <div className="flex items-center gap-3">{rightSlot}</div>
      ) : null}
    </header>
  )
}
