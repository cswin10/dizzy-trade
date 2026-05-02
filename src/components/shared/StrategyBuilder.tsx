'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition } from 'react'

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { twMerge } from 'tailwind-merge'

import {
  createStrategyDefinitionAction,
  updateStrategyDefinitionAction,
  validateStrategyJsonAction,
} from '@/app/actions/strategy-definitions'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import {
  CONDITION_DESCRIPTOR_BY_TYPE,
  SIZING_RULE_DESCRIPTORS,
  STOP_RULE_DESCRIPTORS,
  TARGET_RULE_DESCRIPTORS,
  type ConditionUIDescriptor,
  type ParameterDescriptor,
  type RuleUIDescriptor,
} from '@/lib/strategies/condition-ui-descriptors'
import type {
  Condition,
  EntryGroup,
  SizingRule,
  StopRule,
  StrategyDefinition,
  TargetRule,
} from '@/lib/strategies/types'

import { ConditionPickerModal } from './ConditionPickerModal'
import { StrategyParamInput } from './StrategyParamInput'

export type StrategyBuilderProps = {
  pairUniverse: string[]
  initial?: {
    id: string
    name: string
    description: string | null
    pairs: string[]
    timeframe: string
    max_concurrent_positions: number
    max_daily_loss_gbp: number | null
    max_consecutive_losers: number | null
    definition: StrategyDefinition
  }
}

const TIMEFRAME_OPTIONS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d']

const DEFAULT_DEFINITION: StrategyDefinition = {
  schema_version: 1,
  name: 'New strategy',
  direction: 'long_only',
  entry: {
    groups: [
      {
        direction: 'long',
        conditions: [],
      },
    ],
  },
  exit: {
    stop: { type: 'fixed_pct', pct: 1 },
    target: { type: 'fixed_rr', rr: 2 },
  },
  sizing: { type: 'fixed_gbp_risk', amount: 30 },
}

function defaultsFor(descriptor: {
  parameters: ParameterDescriptor[]
}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of descriptor.parameters) {
    out[p.key] = p.default
  }
  return out
}

export function StrategyBuilder({
  pairUniverse,
  initial,
}: StrategyBuilderProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  const [name, setName] = useState(initial?.name ?? 'New strategy')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [pairs, setPairs] = useState<string[]>(
    initial?.pairs && initial.pairs.length > 0 ? initial.pairs : ['BTC'],
  )
  const [timeframe, setTimeframe] = useState(initial?.timeframe ?? '1h')
  const [maxConcurrent, setMaxConcurrent] = useState(
    initial?.max_concurrent_positions ?? 3,
  )
  const [maxDailyLoss, setMaxDailyLoss] = useState<number | null>(
    initial?.max_daily_loss_gbp ?? 100,
  )
  const [maxConsecLosers, setMaxConsecLosers] = useState<number | null>(
    initial?.max_consecutive_losers ?? 5,
  )

  const [direction, setDirection] = useState<StrategyDefinition['direction']>(
    initial?.definition.direction ?? 'long_only',
  )
  const [groups, setGroups] = useState<EntryGroup[]>(
    initial?.definition.entry.groups ?? DEFAULT_DEFINITION.entry.groups,
  )
  const [stop, setStop] = useState<StopRule>(
    initial?.definition.exit.stop ?? DEFAULT_DEFINITION.exit.stop,
  )
  const [target, setTarget] = useState<TargetRule>(
    initial?.definition.exit.target ?? DEFAULT_DEFINITION.exit.target,
  )
  const [timeoutCandles, setTimeoutCandles] = useState<number | null>(
    initial?.definition.exit.timeout_candles ?? null,
  )
  const [sizing, setSizing] = useState<SizingRule>(
    initial?.definition.sizing ?? DEFAULT_DEFINITION.sizing,
  )
  const [pickerOpenForGroup, setPickerOpenForGroup] = useState<number | null>(
    null,
  )
  const [editJsonMode, setEditJsonMode] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const definition: StrategyDefinition = useMemo(() => {
    return {
      schema_version: 1,
      name,
      description: description.trim().length > 0 ? description : undefined,
      direction,
      entry: { groups },
      exit: {
        stop,
        target,
        ...(timeoutCandles ? { timeout_candles: timeoutCandles } : {}),
      },
      sizing,
    }
  }, [
    name,
    description,
    direction,
    groups,
    stop,
    target,
    timeoutCandles,
    sizing,
  ])

  // Keep the JSON view in sync with the visual state when not in
  // edit-JSON mode. When the user toggles edit-JSON we capture
  // the current state so they can hand-edit from the live shape.
  useEffect(() => {
    if (!editJsonMode) {
      setJsonText(JSON.stringify(definition, null, 2))
      setJsonError(null)
    }
  }, [definition, editJsonMode])

  function applyJsonEdit() {
    try {
      const parsed = JSON.parse(jsonText) as StrategyDefinition
      setName(parsed.name ?? name)
      setDescription(parsed.description ?? '')
      setDirection(parsed.direction ?? direction)
      setGroups(parsed.entry?.groups ?? groups)
      setStop(parsed.exit?.stop ?? stop)
      setTarget(parsed.exit?.target ?? target)
      setTimeoutCandles(parsed.exit?.timeout_candles ?? null)
      setSizing(parsed.sizing ?? sizing)
      setJsonError(null)
      setEditJsonMode(false)
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : 'Invalid JSON')
    }
  }

  function handleValidate() {
    setValidationErrors([])
    setError(null)
    startTransition(async () => {
      const result = await validateStrategyJsonAction(
        JSON.stringify(definition),
      )
      if (!result.ok) {
        setValidationErrors(result.errors)
        return
      }
      setError(null)
      setValidationErrors([])
    })
  }

  function handleSave() {
    setValidationErrors([])
    setError(null)
    startTransition(async () => {
      const validation = await validateStrategyJsonAction(
        JSON.stringify(definition),
      )
      if (!validation.ok) {
        setValidationErrors(validation.errors)
        return
      }
      const result = initial
        ? await updateStrategyDefinitionAction(initial.id, {
            name,
            description: description.trim().length > 0 ? description : null,
            definitionJson: definition,
          })
        : await createStrategyDefinitionAction(name, description, definition)
      if (!result.ok) {
        setError(result.message)
        return
      }
      router.push(`/settings/strategies/${result.row.id}`)
      router.refresh()
    })
  }

  function togglePair(symbol: string) {
    setPairs((current) =>
      current.includes(symbol)
        ? current.filter((s) => s !== symbol)
        : [...current, symbol],
    )
  }

  function addGroup() {
    setGroups((current) => [...current, { direction: 'long', conditions: [] }])
  }

  function removeGroup(index: number) {
    setGroups((current) =>
      current.length === 1 ? current : current.filter((_, i) => i !== index),
    )
  }

  function moveGroup(index: number, dir: -1 | 1) {
    setGroups((current) => {
      const next = [...current]
      const target = index + dir
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })
  }

  function updateGroupDirection(index: number, nextDir: 'long' | 'short') {
    setGroups((current) =>
      current.map((g, i) => (i === index ? { ...g, direction: nextDir } : g)),
    )
  }

  function addConditionToGroup(
    groupIndex: number,
    descriptor: ConditionUIDescriptor,
  ) {
    setGroups((current) =>
      current.map((g, i) =>
        i === groupIndex
          ? {
              ...g,
              conditions: [
                ...g.conditions,
                { type: descriptor.type, params: defaultsFor(descriptor) },
              ],
            }
          : g,
      ),
    )
  }

  function updateCondition(
    groupIndex: number,
    conditionIndex: number,
    next: Condition,
  ) {
    setGroups((current) =>
      current.map((g, i) =>
        i === groupIndex
          ? {
              ...g,
              conditions: g.conditions.map((c, j) =>
                j === conditionIndex ? next : c,
              ),
            }
          : g,
      ),
    )
  }

  function removeCondition(groupIndex: number, conditionIndex: number) {
    setGroups((current) =>
      current.map((g, i) =>
        i === groupIndex
          ? {
              ...g,
              conditions: g.conditions.filter((_, j) => j !== conditionIndex),
            }
          : g,
      ),
    )
  }

  function reorderGroupConditions(
    groupIndex: number,
    fromIndex: number,
    toIndex: number,
  ) {
    setGroups((current) =>
      current.map((g, i) =>
        i === groupIndex
          ? { ...g, conditions: arrayMove(g.conditions, fromIndex, toIndex) }
          : g,
      ),
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
      {/* Left column: configuration */}
      <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
        <Section title="Run">
          <Input
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <label className="mt-3 flex flex-col gap-2 text-xs text-white/45">
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="rounded-md border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </label>
          <div className="mt-3">
            <span className="mb-1 block text-xs text-white/45">Direction</span>
            <SegmentedControl
              options={[
                { value: 'long_only', label: 'Long only' },
                { value: 'short_only', label: 'Short only' },
                { value: 'both', label: 'Both' },
              ]}
              value={direction}
              onChange={(v) =>
                setDirection(v as StrategyDefinition['direction'])
              }
            />
          </div>
        </Section>
        <Section title="Pairs and timeframe">
          <Select
            label="Timeframe"
            value={timeframe}
            onChange={(event) => setTimeframe(event.target.value)}
          >
            {TIMEFRAME_OPTIONS.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </Select>
          <div className="mt-3 flex flex-wrap gap-1">
            {pairUniverse.map((symbol) => {
              const selected = pairs.includes(symbol)
              return (
                <button
                  key={symbol}
                  type="button"
                  onClick={() => togglePair(symbol)}
                  className={twMerge(
                    'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                    selected
                      ? 'border-accent bg-accent/15 text-white'
                      : 'border-white/10 text-white/55 hover:border-white/20 hover:text-white',
                  )}
                >
                  {symbol}
                </button>
              )
            })}
          </div>
        </Section>
        <Section title="Risk caps">
          <Input
            label="Max concurrent positions"
            type="number"
            value={maxConcurrent}
            onChange={(event) => setMaxConcurrent(Number(event.target.value))}
          />
          <Input
            label="Max daily loss (£, blank to disable)"
            type="number"
            value={maxDailyLoss ?? ''}
            onChange={(event) =>
              setMaxDailyLoss(
                event.target.value === '' ? null : Number(event.target.value),
              )
            }
            className="mt-3"
          />
          <Input
            label="Max consecutive losers (blank to disable)"
            type="number"
            value={maxConsecLosers ?? ''}
            onChange={(event) =>
              setMaxConsecLosers(
                event.target.value === '' ? null : Number(event.target.value),
              )
            }
            className="mt-3"
          />
        </Section>
        <Button onClick={handleSave} disabled={isPending} className="w-full">
          {isPending ? 'Saving…' : initial ? 'Save changes' : 'Save draft'}
        </Button>
      </aside>

      {/* Middle column: visual builder */}
      <main className="flex flex-col gap-5">
        {validationErrors.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            {validationErrors.map((err, i) => (
              <li key={i} className="font-mono">
                {err}
              </li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <Section title="Entry conditions">
          <div className="flex flex-col gap-4">
            {groups.map((group, gi) => (
              <div
                key={gi}
                className="rounded-lg border border-white/[0.06] bg-surface-2 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-white/45">
                      Group {gi + 1}
                    </span>
                    <SegmentedControl
                      options={[
                        { value: 'long', label: 'Long' },
                        { value: 'short', label: 'Short' },
                      ]}
                      value={group.direction}
                      onChange={(v) =>
                        updateGroupDirection(gi, v as 'long' | 'short')
                      }
                      compact
                    />
                  </div>
                  <div className="flex items-center gap-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => moveGroup(gi, -1)}
                      disabled={gi === 0}
                      className="rounded border border-white/10 px-1.5 py-0.5 text-white/55 hover:border-white/25 hover:text-white disabled:opacity-30"
                      aria-label="Move group up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveGroup(gi, 1)}
                      disabled={gi === groups.length - 1}
                      className="rounded border border-white/10 px-1.5 py-0.5 text-white/55 hover:border-white/25 hover:text-white disabled:opacity-30"
                      aria-label="Move group down"
                    >
                      ↓
                    </button>
                    {groups.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeGroup(gi)}
                        className="rounded border border-white/10 px-1.5 py-0.5 text-white/55 hover:border-red-500/40 hover:text-red-300"
                      >
                        Remove group
                      </button>
                    ) : null}
                  </div>
                </div>

                <ConditionList
                  conditions={group.conditions}
                  onUpdate={(idx, next) => updateCondition(gi, idx, next)}
                  onRemove={(idx) => removeCondition(gi, idx)}
                  onReorder={(from, to) => reorderGroupConditions(gi, from, to)}
                />

                <button
                  type="button"
                  onClick={() => setPickerOpenForGroup(gi)}
                  className="mt-2 w-full rounded-md border border-dashed border-white/10 px-3 py-2 text-xs text-white/55 transition-colors hover:border-accent hover:text-white"
                >
                  + Add condition
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addGroup}
              className="rounded-md border border-dashed border-white/10 px-3 py-2 text-xs text-white/55 transition-colors hover:border-accent hover:text-white"
            >
              + Add another group (OR)
            </button>
          </div>
        </Section>

        <Section title="Exit rules">
          <RuleEditor<StopRule>
            label="Stop"
            descriptors={STOP_RULE_DESCRIPTORS}
            value={stop}
            onChange={setStop}
          />
          <RuleEditor<TargetRule>
            label="Target"
            descriptors={TARGET_RULE_DESCRIPTORS}
            value={target}
            onChange={setTarget}
            className="mt-4"
          />
          <Input
            label="Timeout candles (blank for no timeout)"
            type="number"
            value={timeoutCandles ?? ''}
            onChange={(event) =>
              setTimeoutCandles(
                event.target.value === '' ? null : Number(event.target.value),
              )
            }
            className="mt-4"
          />
        </Section>

        <Section title="Sizing">
          <RuleEditor<SizingRule>
            label="Sizing"
            descriptors={SIZING_RULE_DESCRIPTORS}
            value={sizing}
            onChange={setSizing}
          />
        </Section>
      </main>

      {/* Right column: JSON preview */}
      <aside className="flex flex-col gap-2 lg:sticky lg:top-20 lg:self-start">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-white/55">
            JSON preview
          </span>
          <label className="flex items-center gap-2 text-xs text-white/55">
            <input
              type="checkbox"
              checked={editJsonMode}
              onChange={(event) => setEditJsonMode(event.target.checked)}
            />
            Edit directly
          </label>
        </div>
        {editJsonMode ? (
          <>
            <textarea
              value={jsonText}
              onChange={(event) => setJsonText(event.target.value)}
              rows={28}
              spellCheck={false}
              className="rounded-md border border-white/10 bg-surface p-3 font-mono text-[11px] text-white/85 outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
            {jsonError ? (
              <p className="text-[11px] text-red-300">{jsonError}</p>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              className="w-auto self-end"
              onClick={applyJsonEdit}
            >
              Apply edit
            </Button>
          </>
        ) : (
          <pre className="max-h-[640px] overflow-y-auto rounded-md border border-white/[0.06] bg-surface p-3 font-mono text-[11px] text-white/75">
            {jsonText}
          </pre>
        )}
        <Button
          type="button"
          variant="ghost"
          className="w-auto self-end"
          onClick={handleValidate}
          disabled={isPending}
        >
          Validate
        </Button>
      </aside>

      <ConditionPickerModal
        open={pickerOpenForGroup !== null}
        onClose={() => setPickerOpenForGroup(null)}
        onPick={(descriptor) => {
          if (pickerOpenForGroup !== null) {
            addConditionToGroup(pickerOpenForGroup, descriptor)
          }
        }}
      />
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-white/[0.06] bg-surface p-4">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-white/55">
        {title}
      </h2>
      {children}
    </section>
  )
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  compact = false,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (next: T) => void
  compact?: boolean
}) {
  return (
    <div
      className={twMerge(
        'inline-flex rounded-md border border-white/10 bg-surface-2 p-0.5',
        compact ? 'text-[11px]' : 'text-xs',
      )}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={twMerge(
            'rounded px-2 py-1 transition-colors',
            opt.value === value
              ? 'bg-accent/20 text-white'
              : 'text-white/55 hover:text-white',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function ConditionList({
  conditions,
  onUpdate,
  onRemove,
  onReorder,
}: {
  conditions: Condition[]
  onUpdate: (index: number, next: Condition) => void
  onRemove: (index: number) => void
  onReorder: (from: number, to: number) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = Number(active.id)
    const to = Number(over.id)
    if (Number.isFinite(from) && Number.isFinite(to)) onReorder(from, to)
  }

  if (conditions.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-white/[0.08] bg-surface p-3 text-xs text-white/45">
        Add a condition to get started.
      </p>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={conditions.map((_, i) => String(i))}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col gap-2">
          {conditions.map((c, idx) => (
            <SortableConditionCard
              key={idx}
              id={String(idx)}
              condition={c}
              onUpdate={(next) => onUpdate(idx, next)}
              onRemove={() => onRemove(idx)}
              showAndJoin={idx < conditions.length - 1}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

function SortableConditionCard({
  id,
  condition,
  onUpdate,
  onRemove,
  showAndJoin,
}: {
  id: string
  condition: Condition
  onUpdate: (next: Condition) => void
  onRemove: () => void
  showAndJoin: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }
  const descriptor = CONDITION_DESCRIPTOR_BY_TYPE.get(condition.type)
  const [expanded, setExpanded] = useState(true)

  return (
    <li ref={setNodeRef} style={style}>
      <div className="rounded-md border border-white/[0.06] bg-surface p-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab rounded px-1 text-white/35 hover:bg-surface-2 hover:text-white/65 active:cursor-grabbing"
            aria-label="Reorder"
          >
            ⋮⋮
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex flex-1 flex-col items-start text-left"
          >
            <span className="text-sm text-white">
              {descriptor?.title ?? condition.type}
            </span>
            <span className="font-mono text-[10px] text-white/45">
              {condition.type}
            </span>
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-white/55 transition-colors hover:border-red-500/40 hover:text-red-300"
          >
            Remove
          </button>
        </div>
        {expanded && descriptor && descriptor.parameters.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {descriptor.parameters.map((param) => (
              <StrategyParamInput
                key={param.key}
                descriptor={param}
                value={condition.params[param.key]}
                onChange={(v) =>
                  onUpdate({
                    ...condition,
                    params: { ...condition.params, [param.key]: v },
                  })
                }
              />
            ))}
          </div>
        ) : null}
        {expanded && descriptor && descriptor.parameters.length === 0 ? (
          <p className="mt-2 text-[11px] text-white/45">
            No parameters for this condition.
          </p>
        ) : null}
      </div>
      {showAndJoin ? (
        <p className="my-1 text-center text-[10px] uppercase tracking-widest text-white/35">
          AND
        </p>
      ) : null}
    </li>
  )
}

function RuleEditor<T extends { type: string } & Record<string, unknown>>({
  label,
  descriptors,
  value,
  onChange,
  className,
}: {
  label: string
  descriptors: RuleUIDescriptor[]
  value: T
  onChange: (next: T) => void
  className?: string
}) {
  const descriptor = descriptors.find((d) => d.type === value.type)
  return (
    <div className={className}>
      <span className="mb-1 block text-xs text-white/45">{label}</span>
      <SegmentedControl
        options={descriptors.map((d) => ({ value: d.type, label: d.title }))}
        value={value.type}
        onChange={(nextType) => {
          const target = descriptors.find((d) => d.type === nextType)!
          const fresh: Record<string, unknown> = {
            type: nextType,
            ...defaultsFor(target),
          }
          onChange(fresh as unknown as T)
        }}
      />
      {descriptor && descriptor.parameters.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {descriptor.parameters.map((param) => (
            <StrategyParamInput
              key={param.key}
              descriptor={param}
              value={(value as Record<string, unknown>)[param.key]}
              onChange={(v) =>
                onChange({
                  ...(value as object),
                  [param.key]: v,
                } as T)
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
