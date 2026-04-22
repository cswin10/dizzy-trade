'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useTransition } from 'react'

import { twMerge } from 'tailwind-merge'

import { Select } from '@/components/ui/Select'

export type AlertFilterOption = { id: string; label: string }

export type AlertFiltersProps = {
  frameworks: AlertFilterOption[]
}

export function AlertFilters({ frameworks }: AlertFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  const update = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString())
      if (!value || value === 'all') next.delete(key)
      else next.set(key, value)
      const qs = next.toString()
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname)
      })
    },
    [params, pathname, router],
  )

  const watchlistOnly = params.get('watchlist') === '1'
  const showDismissed = params.get('dismissed') === '1'
  const framework = params.get('framework') ?? 'all'

  return (
    <div
      className={twMerge(
        'flex flex-wrap items-end gap-3',
        pending && 'opacity-70',
      )}
    >
      <div className="w-52">
        <Select
          label="Framework"
          name="framework"
          value={framework}
          onChange={(e) => update('framework', e.target.value)}
        >
          <option value="all">All frameworks</option>
          {frameworks.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>
      <Toggle
        label="Watchlist only"
        checked={watchlistOnly}
        onChange={(checked) => update('watchlist', checked ? '1' : null)}
      />
      <Toggle
        label="Show dismissed"
        checked={showDismissed}
        onChange={(checked) => update('dismissed', checked ? '1' : null)}
      />
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex h-11 cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-transparent px-3 text-sm text-white/70 transition-colors duration-200 hover:border-white/20 hover:text-white">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border border-white/20 bg-transparent accent-accent"
      />
      <span>{label}</span>
    </label>
  )
}
