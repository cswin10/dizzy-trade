'use client'

import { useMemo, useState, useTransition, type ReactNode } from 'react'

import { twMerge } from 'tailwind-merge'

import {
  createStrategyAction,
  deleteStrategyAction,
  toggleStrategyActiveAction,
  updateStrategyAction,
} from '@/app/actions/strategies'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Panel } from '@/components/ui/Panel'
import { Select } from '@/components/ui/Select'

import { ConfirmDialog } from './ConfirmDialog'
import {
  TIMEFRAMES,
  type StrategyInput,
  type Timeframe,
} from '@/lib/validations/strategy'

export type StrategyRow = {
  id: string
  name: string
  framework_id: string
  timeframe: Timeframe
  pair_symbols: string[]
  risk_amount_gbp: number
  min_rr: number
  max_concurrent_positions: number
  max_daily_loss_gbp: number | null
  max_consecutive_losers: number | null
  is_active: boolean
}

type FrameworkOption = { id: string; label: string }

const FRAMEWORK_OPTIONS: FrameworkOption[] = [
  { id: 'mean_reversion_v1', label: 'Mean Reversion' },
  { id: 'narrative_breakout_v1', label: 'Narrative Breakout' },
  { id: 'liquidation_hunt_v1', label: 'Liquidation Hunt' },
  { id: 'simple_rsi_v1', label: 'Simple RSI' },
]

export type StrategiesEditorProps = {
  initialStrategies: StrategyRow[]
  universeSymbols: string[]
}

const defaultDraft = (): FormDraft => ({
  name: '',
  framework_id: FRAMEWORK_OPTIONS[0]!.id,
  timeframe: '1h',
  pair_symbols: [],
  risk_amount_gbp: 30,
  min_rr: 2.0,
  max_concurrent_positions: 3,
  max_daily_loss_gbp: null,
  max_consecutive_losers: 5,
})

type FormDraft = {
  name: string
  framework_id: string
  timeframe: Timeframe
  pair_symbols: string[]
  risk_amount_gbp: number
  min_rr: number
  max_concurrent_positions: number
  max_daily_loss_gbp: number | null
  max_consecutive_losers: number | null
}

function rowToDraft(row: StrategyRow): FormDraft {
  return {
    name: row.name,
    framework_id: row.framework_id,
    timeframe: row.timeframe,
    pair_symbols: [...row.pair_symbols],
    risk_amount_gbp: row.risk_amount_gbp,
    min_rr: row.min_rr,
    max_concurrent_positions: row.max_concurrent_positions,
    max_daily_loss_gbp: row.max_daily_loss_gbp,
    max_consecutive_losers: row.max_consecutive_losers,
  }
}

function draftToInput(draft: FormDraft, isActive: boolean): StrategyInput {
  return {
    name: draft.name,
    framework_id: draft.framework_id,
    timeframe: draft.timeframe,
    pair_symbols: draft.pair_symbols,
    risk_amount_gbp: draft.risk_amount_gbp,
    min_rr: draft.min_rr,
    max_concurrent_positions: draft.max_concurrent_positions,
    max_daily_loss_gbp: draft.max_daily_loss_gbp,
    max_consecutive_losers: draft.max_consecutive_losers,
    deployment_status: isActive ? 'live' : 'draft',
  }
}

export function StrategiesEditor({
  initialStrategies,
  universeSymbols,
}: StrategiesEditorProps) {
  const [strategies, setStrategies] = useState<StrategyRow[]>(initialStrategies)
  const [creating, setCreating] = useState(false)

  const onCreated = (row: StrategyRow) => {
    setStrategies((prev) => [...prev, row])
  }
  const onUpdated = (row: StrategyRow) => {
    setStrategies((prev) => prev.map((s) => (s.id === row.id ? row : s)))
  }
  const onDeleted = (id: string) => {
    setStrategies((prev) => prev.filter((s) => s.id !== id))
  }
  const onActiveToggled = (id: string, active: boolean) => {
    setStrategies((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, is_active: active }
          : active
            ? { ...s, is_active: false }
            : s,
      ),
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-xs text-white/45">
          One strategy can be active at a time. Activating a strategy
          deactivates any other.
        </p>
        <Button
          type="button"
          onClick={() => setCreating(true)}
          className="w-full px-3 text-xs sm:w-auto"
        >
          Add strategy
        </Button>
      </div>

      {strategies.length === 0 ? (
        <Panel>
          <p className="py-6 text-center text-sm text-white/45">
            No strategies yet. Click Add strategy to create one.
          </p>
        </Panel>
      ) : null}

      {strategies.map((row) => (
        <StrategyPanel
          key={row.id}
          row={row}
          universeSymbols={universeSymbols}
          onUpdated={onUpdated}
          onDeleted={onDeleted}
          onActiveToggled={onActiveToggled}
        />
      ))}

      <CreateStrategyDialog
        open={creating}
        universeSymbols={universeSymbols}
        onClose={() => setCreating(false)}
        onCreated={(row) => {
          onCreated(row)
          setCreating(false)
        }}
      />
    </div>
  )
}

function StrategyPanel({
  row,
  universeSymbols,
  onUpdated,
  onDeleted,
  onActiveToggled,
}: {
  row: StrategyRow
  universeSymbols: string[]
  onUpdated: (row: StrategyRow) => void
  onDeleted: (id: string) => void
  onActiveToggled: (id: string, active: boolean) => void
}) {
  const [draft, setDraft] = useState<FormDraft>(rowToDraft(row))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const dirty = useMemo(() => isDirty(draft, row), [draft, row])

  const save = () => {
    setError(null)
    startTransition(async () => {
      const result = await updateStrategyAction(
        row.id,
        draftToInput(draft, row.is_active),
      )
      if (!result.ok) {
        setError(result.message ?? 'Save failed')
        return
      }
      onUpdated({ ...row, ...draft })
    })
  }

  const toggleActive = () => {
    const next = !row.is_active
    setError(null)
    startTransition(async () => {
      const result = await toggleStrategyActiveAction(row.id, next)
      if (!result.ok) {
        setError(result.message ?? 'Activation failed')
        return
      }
      onActiveToggled(row.id, next)
    })
  }

  const remove = () => {
    setError(null)
    startTransition(async () => {
      const result = await deleteStrategyAction(row.id)
      if (!result.ok) {
        setError(result.message ?? 'Delete failed')
        setConfirmDeleteOpen(false)
        return
      }
      setConfirmDeleteOpen(false)
      onDeleted(row.id)
    })
  }

  return (
    <Panel
      title={row.name}
      headerRight={
        <button
          type="button"
          onClick={toggleActive}
          aria-pressed={row.is_active}
          className={twMerge(
            'inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-medium transition-colors duration-150',
            row.is_active
              ? 'border-positive/40 bg-positive/15 text-positive'
              : 'border-white/10 text-white/55 hover:border-white/20 hover:text-white',
          )}
        >
          <span
            aria-hidden
            className={twMerge(
              'h-1.5 w-1.5 rounded-full',
              row.is_active ? 'bg-positive' : 'bg-white/35',
            )}
          />
          <span>{row.is_active ? 'Active' : 'Inactive'}</span>
        </button>
      }
    >
      <StrategyForm
        draft={draft}
        setDraft={setDraft}
        universeSymbols={universeSymbols}
      />

      {error ? <p className="mt-3 text-xs text-negative">{error}</p> : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setConfirmDeleteOpen(true)}
          disabled={pending}
          className="text-xs text-white/45 transition-colors duration-150 hover:text-negative disabled:cursor-not-allowed disabled:opacity-50"
        >
          Delete strategy
        </button>
        <Button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="w-full px-4 sm:w-auto"
        >
          {pending ? 'Saving' : 'Save changes'}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={remove}
        title="Delete strategy?"
        message={`"${row.name}" will be removed. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        busy={pending}
      />
    </Panel>
  )
}

function StrategyForm({
  draft,
  setDraft,
  universeSymbols,
}: {
  draft: FormDraft
  setDraft: (next: FormDraft) => void
  universeSymbols: string[]
}) {
  const set = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) =>
    setDraft({ ...draft, [key]: value })

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Input
        label="Name"
        name="name"
        value={draft.name}
        onChange={(e) => set('name', e.target.value)}
        required
      />
      <Select
        label="Framework"
        name="framework_id"
        value={draft.framework_id}
        onChange={(e) => set('framework_id', e.target.value)}
      >
        {FRAMEWORK_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </Select>
      <Select
        label="Timeframe"
        name="timeframe"
        value={draft.timeframe}
        onChange={(e) => set('timeframe', e.target.value as Timeframe)}
      >
        {TIMEFRAMES.map((tf) => (
          <option key={tf} value={tf}>
            {tf}
          </option>
        ))}
      </Select>
      <NumberField
        label="Risk amount (£)"
        value={draft.risk_amount_gbp}
        onChange={(v) => set('risk_amount_gbp', v ?? 0)}
        min={0.01}
        step={0.01}
      />
      <NumberField
        label="Min RR"
        value={draft.min_rr}
        onChange={(v) => set('min_rr', v ?? 0)}
        min={0.1}
        step={0.1}
      />
      <NumberField
        label="Max concurrent positions"
        value={draft.max_concurrent_positions}
        onChange={(v) => set('max_concurrent_positions', v ?? 1)}
        min={1}
        step={1}
      />
      <NumberField
        label="Max daily loss (£) (optional)"
        value={draft.max_daily_loss_gbp}
        onChange={(v) => set('max_daily_loss_gbp', v)}
        min={0.01}
        step={0.01}
        nullable
      />
      <NumberField
        label="Max consecutive losers (optional)"
        value={draft.max_consecutive_losers}
        onChange={(v) => set('max_consecutive_losers', v)}
        min={1}
        step={1}
        nullable
      />
      <div className="md:col-span-2">
        <PairSelector
          label="Pair symbols"
          values={draft.pair_symbols}
          options={universeSymbols}
          onChange={(next) => set('pair_symbols', next)}
        />
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min,
  step,
  nullable,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  min?: number
  step?: number
  nullable?: boolean
}) {
  return (
    <Input
      label={label}
      type="number"
      min={min}
      step={step}
      value={value === null ? '' : String(value)}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === '') {
          onChange(nullable ? null : 0)
          return
        }
        const n = Number(raw)
        onChange(Number.isFinite(n) ? n : nullable ? null : 0)
      }}
    />
  )
}

function PairSelector({
  label,
  values,
  options,
  onChange,
}: {
  label: string
  values: string[]
  options: string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  const remove = (sym: string) => onChange(values.filter((v) => v !== sym))
  const add = (sym: string) => {
    const cleaned = sym.trim().toUpperCase()
    if (!cleaned) return
    if (values.includes(cleaned)) {
      setDraft('')
      return
    }
    onChange([...values, cleaned])
    setDraft('')
  }

  const suggestions = useMemo(() => {
    const q = draft.trim().toUpperCase()
    if (!q) return []
    return options
      .filter((o) => o.startsWith(q) && !values.includes(o))
      .slice(0, 8)
  }, [draft, options, values])

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-white/45">{label}</span>
      <div className="flex flex-wrap gap-2 rounded-md border border-white/10 bg-surface-2/40 p-2">
        {values.length === 0 ? (
          <span className="px-2 py-1 text-xs text-white/35">
            No pairs selected
          </span>
        ) : null}
        {values.map((sym) => (
          <span
            key={sym}
            className="inline-flex items-center gap-1.5 rounded bg-accent/15 px-2 py-1 text-xs font-medium text-accent"
          >
            {sym}
            <button
              type="button"
              onClick={() => remove(sym)}
              aria-label={`Remove ${sym}`}
              className="text-accent/70 hover:text-accent"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            }
          }}
          placeholder="Type a symbol and press Enter"
          className="h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-accent focus:ring-1 focus:ring-accent"
        />
        {suggestions.length > 0 ? (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-white/[0.08] bg-surface-2 p-1 shadow-lg">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => add(s)}
                className="block w-full rounded px-2 py-1 text-left text-xs text-white/80 hover:bg-white/5"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function CreateStrategyDialog({
  open,
  onClose,
  onCreated,
  universeSymbols,
}: {
  open: boolean
  onClose: () => void
  onCreated: (row: StrategyRow) => void
  universeSymbols: string[]
}) {
  const [draft, setDraft] = useState<FormDraft>(defaultDraft())
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const result = await createStrategyAction(draftToInput(draft, false))
      if (!result.ok || !result.id) {
        setError(result.message ?? 'Create failed')
        return
      }
      onCreated({
        id: result.id,
        ...draft,
        is_active: false,
      })
      setDraft(defaultDraft())
    })
  }

  const cancel = () => {
    setDraft(defaultDraft())
    setError(null)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={cancel}
      title="Add strategy"
      description="New strategies start inactive. Activate one when you're ready to scan."
      className="max-w-2xl"
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={cancel}
            className="w-auto px-4"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending}
            className="w-auto px-4"
          >
            {pending ? 'Creating' : 'Create'}
          </Button>
        </>
      }
    >
      <Section>
        <StrategyForm
          draft={draft}
          setDraft={setDraft}
          universeSymbols={universeSymbols}
        />
        {error ? <p className="mt-3 text-xs text-negative">{error}</p> : null}
      </Section>
    </Dialog>
  )
}

function Section({ children }: { children: ReactNode }) {
  return <div className="space-y-4">{children}</div>
}

function isDirty(draft: FormDraft, row: StrategyRow): boolean {
  if (draft.name !== row.name) return true
  if (draft.framework_id !== row.framework_id) return true
  if (draft.timeframe !== row.timeframe) return true
  if (draft.risk_amount_gbp !== row.risk_amount_gbp) return true
  if (draft.min_rr !== row.min_rr) return true
  if (draft.max_concurrent_positions !== row.max_concurrent_positions)
    return true
  if (draft.max_daily_loss_gbp !== row.max_daily_loss_gbp) return true
  if (draft.max_consecutive_losers !== row.max_consecutive_losers) return true
  if (draft.pair_symbols.length !== row.pair_symbols.length) return true
  for (let i = 0; i < draft.pair_symbols.length; i++) {
    if (draft.pair_symbols[i] !== row.pair_symbols[i]) return true
  }
  return false
}
