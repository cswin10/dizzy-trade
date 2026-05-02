'use client'

import { twMerge } from 'tailwind-merge'

import type { ParameterDescriptor } from '@/lib/strategies/condition-ui-descriptors'

export type StrategyParamInputProps = {
  descriptor: ParameterDescriptor
  value: unknown
  onChange: (value: unknown) => void
  error?: string | null
}

// Single-parameter input renderer. The visual builder, the exit-
// rule editor, and the sizing-rule editor all share this so the
// look-and-feel of every dynamic form stays consistent.
export function StrategyParamInput({
  descriptor,
  value,
  onChange,
  error,
}: StrategyParamInputProps) {
  return (
    <label className="flex flex-col gap-1 text-xs text-white/55">
      <span>
        {descriptor.label}
        {!descriptor.required ? (
          <span className="ml-1 text-white/35">(optional)</span>
        ) : null}
      </span>
      {descriptor.type === 'number' ? (
        <input
          type="number"
          value={typeof value === 'number' ? value : ''}
          step={descriptor.step ?? 1}
          min={descriptor.min}
          max={descriptor.max}
          onChange={(event) => {
            const v = event.target.value
            onChange(v === '' ? null : Number(v))
          }}
          className={twMerge(
            'h-9 rounded-md border border-white/10 bg-transparent px-2 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent',
            error && 'border-red-500/40 focus:border-red-500',
          )}
        />
      ) : null}
      {descriptor.type === 'string_enum' ? (
        <select
          value={
            typeof value === 'string' ? value : (descriptor.default as string)
          }
          onChange={(event) => onChange(event.target.value)}
          className={twMerge(
            'h-9 rounded-md border border-white/10 bg-transparent px-2 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent',
            error && 'border-red-500/40',
          )}
        >
          {(descriptor.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : null}
      {descriptor.type === 'boolean' ? (
        <label className="flex items-center gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
          />
          {descriptor.helpText ?? 'Enabled'}
        </label>
      ) : null}
      {descriptor.type === 'number_array' ? (
        <input
          type="text"
          value={Array.isArray(value) ? (value as number[]).join(', ') : ''}
          onChange={(event) => {
            const parsed = event.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => Number(s))
              .filter((n) => Number.isFinite(n))
            onChange(parsed)
          }}
          placeholder={descriptor.helpText ?? 'Comma-separated numbers'}
          className={twMerge(
            'h-9 rounded-md border border-white/10 bg-transparent px-2 font-mono text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent',
            error && 'border-red-500/40',
          )}
        />
      ) : null}
      {descriptor.helpText && descriptor.type !== 'boolean' ? (
        <span className="text-[11px] text-white/35">{descriptor.helpText}</span>
      ) : null}
      {error ? <span className="text-[11px] text-red-300">{error}</span> : null}
    </label>
  )
}
