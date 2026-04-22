import { type ReactNode } from 'react'

export type PageHeaderProps = {
  title: string
  subtitle?: string
  rightSlot?: ReactNode
}

export function PageHeader({ title, subtitle, rightSlot }: PageHeaderProps) {
  return (
    <header className="mb-8 flex items-end justify-between gap-4 border-b border-white/[0.04] pb-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium tracking-tight text-white">
          {title}
        </h1>
        {subtitle ? <p className="text-sm text-white/45">{subtitle}</p> : null}
      </div>
      {rightSlot ? (
        <div className="flex items-center gap-3">{rightSlot}</div>
      ) : null}
    </header>
  )
}
