'use client'

import { twMerge } from 'tailwind-merge'

export type PillToggleOption<T extends string> = {
  value: T
  label: string
}

export type PillToggleProps<T extends string> = {
  label?: string
  hint?: string
  name?: string
  value: T | undefined
  onChange: (value: T) => void
  options: ReadonlyArray<PillToggleOption<T> | T>
  required?: boolean
  className?: string
}

function normalise<T extends string>(
  option: PillToggleOption<T> | T,
): PillToggleOption<T> {
  if (typeof option === 'string') return { value: option, label: option }
  return option
}

export function PillToggle<T extends string>({
  label,
  hint,
  name,
  value,
  onChange,
  options,
  required,
  className,
}: PillToggleProps<T>) {
  return (
    <div className={twMerge('flex flex-col gap-2', className)}>
      {label ? (
        <span className="text-xs text-white/45">
          {label}
          {required ? <span className="text-negative"> *</span> : null}
        </span>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const o = normalise(opt)
          const selected = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={selected}
              className={twMerge(
                'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors duration-200',
                selected
                  ? 'border-accent bg-accent/15 text-white'
                  : 'border-white/10 bg-transparent text-white/60 hover:border-white/20 hover:text-white',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {hint ? <span className="text-xs text-white/35">{hint}</span> : null}
      {name ? (
        <input type="hidden" name={name} value={value ?? ''} readOnly />
      ) : null}
    </div>
  )
}
