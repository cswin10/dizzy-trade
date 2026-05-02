'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import type { SweepDimension } from '@/lib/backtest/sweep'

export type SweepDimensionEditorProps = {
  thresholdKeys: string[]
  initial?: SweepDimension
  onSave: (dimension: SweepDimension) => void
  onCancel: () => void
  // When provided (composable sweeps), the parameter dropdown
  // shows JSON paths into the strategy definition with friendly
  // labels instead of the framework risk/threshold dropdowns.
  pathSuggestions?: Array<{ path: string; label: string }>
}

const RISK_KEYS = [
  { key: 'risk_amount_gbp', label: 'Risk amount (£)', group: 'risk' },
  { key: 'min_rr', label: 'Min R:R', group: 'risk' },
  { key: 'max_concurrent_positions', label: 'Max concurrent', group: 'risk' },
  { key: 'max_daily_loss_gbp', label: 'Max daily loss (£)', group: 'risk' },
  { key: 'slippage_pct', label: 'Slippage %', group: 'fees' },
  { key: 'maker_fee_pct', label: 'Maker fee %', group: 'fees' },
  { key: 'taker_fee_pct', label: 'Taker fee %', group: 'fees' },
  { key: 'assume_taker', label: 'Assume taker fills', group: 'fees' },
] as const

export function SweepDimensionEditor({
  thresholdKeys,
  initial,
  onSave,
  onCancel,
  pathSuggestions,
}: SweepDimensionEditorProps) {
  const [key, setKey] = useState<string>(
    initial?.key ??
      pathSuggestions?.[0]?.path ??
      thresholdKeys[0] ??
      'risk_amount_gbp',
  )
  const [type, setType] = useState<'range' | 'enum' | 'boolean'>(
    initial?.type ?? 'range',
  )
  const [start, setStart] = useState<number>(
    initial && initial.type === 'range' ? initial.start : 0,
  )
  const [end, setEnd] = useState<number>(
    initial && initial.type === 'range' ? initial.end : 1,
  )
  const [step, setStep] = useState<number>(
    initial && initial.type === 'range' ? initial.step : 0.5,
  )
  const [enumText, setEnumText] = useState<string>(
    initial && initial.type === 'enum'
      ? initial.values.map((v) => String(v)).join(', ')
      : '',
  )

  // assume_taker is the only true boolean; the dimension type
  // collapses to 'boolean' automatically when that key is picked.
  const isBooleanKey = key === 'assume_taker'

  function handleSave() {
    if (isBooleanKey) {
      onSave({ type: 'boolean', key })
      return
    }
    if (type === 'range') {
      if (!Number.isFinite(start) || !Number.isFinite(end) || step <= 0) return
      if (end < start) return
      onSave({ type: 'range', key, start, end, step })
      return
    }
    if (type === 'enum') {
      const values = enumText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const n = Number(s)
          return Number.isFinite(n) ? n : s
        })
      if (values.length === 0) return
      onSave({ type: 'enum', key, values })
    }
  }

  return (
    <div className="rounded-lg border border-white/[0.06] bg-surface-2 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Parameter"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        >
          {pathSuggestions && pathSuggestions.length > 0 ? (
            <optgroup label="Strategy paths">
              {pathSuggestions.map((s) => (
                <option key={s.path} value={s.path}>
                  {s.label}
                </option>
              ))}
            </optgroup>
          ) : (
            <optgroup label="Framework thresholds">
              {thresholdKeys.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Risk">
            {RISK_KEYS.filter((r) => r.group === 'risk').map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Fees and slippage">
            {RISK_KEYS.filter((r) => r.group === 'fees').map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </optgroup>
        </Select>
        {!isBooleanKey ? (
          <Select
            label="Type"
            value={type}
            onChange={(event) =>
              setType(event.target.value as 'range' | 'enum' | 'boolean')
            }
          >
            <option value="range">Range (start, end, step)</option>
            <option value="enum">Enum (comma-separated values)</option>
          </Select>
        ) : (
          <div className="flex items-end text-xs text-white/45">
            assume_taker is automatically swept as true and false.
          </div>
        )}
      </div>

      {!isBooleanKey && type === 'range' ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Input
            label="Start"
            type="number"
            step="any"
            value={start}
            onChange={(event) => setStart(Number(event.target.value))}
          />
          <Input
            label="End"
            type="number"
            step="any"
            value={end}
            onChange={(event) => setEnd(Number(event.target.value))}
          />
          <Input
            label="Step"
            type="number"
            step="any"
            value={step}
            onChange={(event) => setStep(Number(event.target.value))}
          />
        </div>
      ) : null}

      {!isBooleanKey && type === 'enum' ? (
        <div className="mt-3">
          <Input
            label="Values (comma-separated)"
            value={enumText}
            placeholder="e.g. 25, 30, 35"
            onChange={(event) => setEnumText(event.target.value)}
          />
        </div>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} className="w-auto">
          Cancel
        </Button>
        <Button onClick={handleSave} className="w-auto">
          Save dimension
        </Button>
      </div>
    </div>
  )
}
