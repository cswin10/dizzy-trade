'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { twMerge } from 'tailwind-merge'

import { saveAnalyticsLayout } from '@/app/actions/user-preferences'

export type ChartPanel = {
  id: string
  // CSS column span on the lg breakpoint. 'full' = lg:col-span-2,
  // 'half' = lg:col-span-1.
  span: 'full' | 'half'
  node: ReactNode
}

export type SortableChartGridProps = {
  panels: ChartPanel[]
  defaultOrder: string[]
  initialOrder: string[] | null
}

const SAVE_DEBOUNCE_MS = 1000

/**
 * Validates a stored layout against the canonical default. Unknown
 * panel ids are dropped, missing ones are appended, so the layout
 * self-heals across releases.
 */
function reconcileOrder(stored: string[] | null, defaults: string[]): string[] {
  if (!stored || stored.length === 0) return defaults
  const known = new Set(defaults)
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of stored) {
    if (!known.has(id) || seen.has(id)) continue
    out.push(id)
    seen.add(id)
  }
  for (const id of defaults) {
    if (!seen.has(id)) out.push(id)
  }
  return out
}

export function SortableChartGrid({
  panels,
  defaultOrder,
  initialOrder,
}: SortableChartGridProps) {
  const initial = useMemo(
    () => reconcileOrder(initialOrder, defaultOrder),
    [initialOrder, defaultOrder],
  )
  const [order, setOrder] = useState<string[]>(initial)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = useCallback((next: string[]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void saveAnalyticsLayout(next)
    }, SAVE_DEBOUNCE_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const panelById = useMemo(() => {
    const map = new Map<string, ChartPanel>()
    for (const panel of panels) map.set(panel.id, panel)
    return map
  }, [panels])

  // Drop ids that resolve to nothing. Defensive against stored
  // ordering that references panels which were removed.
  const ordered = useMemo(
    () => order.map((id) => panelById.get(id)).filter(Boolean) as ChartPanel[],
    [order, panelById],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrder((current) => {
      const oldIndex = current.indexOf(String(active.id))
      const newIndex = current.indexOf(String(over.id))
      if (oldIndex < 0 || newIndex < 0) return current
      const next = arrayMove(current, oldIndex, newIndex)
      persist(next)
      return next
    })
  }

  const reset = () => {
    setOrder(defaultOrder)
    persist(defaultOrder)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-white/35">
          Drag the handle to rearrange charts
        </p>
        <button
          type="button"
          onClick={reset}
          className="font-mono text-[10px] uppercase tracking-widest text-white/45 transition-colors duration-150 hover:text-accent"
        >
          Reset to default
        </button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {ordered.map((panel, index) => (
              <SortableSlot
                key={panel.id}
                id={panel.id}
                span={panel.span}
                index={index}
              >
                {panel.node}
              </SortableSlot>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function SortableSlot({
  id,
  span,
  index,
  children,
}: {
  id: string
  span: 'full' | 'half'
  index: number
  children: ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    animationDelay: `${index * 50}ms`,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={twMerge(
        'group relative animate-chart-enter',
        span === 'full' ? 'lg:col-span-2' : 'lg:col-span-1',
        isDragging && 'z-30 opacity-60',
      )}
    >
      {isDragging ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-lg border border-dashed border-accent/60"
        />
      ) : null}
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label="Drag to rearrange"
        {...attributes}
        {...listeners}
        className={twMerge(
          'absolute right-1.5 top-1.5 z-10 inline-flex h-9 w-9 cursor-grab items-center justify-center rounded-md text-white/45 transition-colors duration-150 sm:right-2 sm:top-2 sm:h-6 sm:w-6 sm:text-white/30',
          'hover:bg-white/5 hover:text-accent focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100',
          isDragging && 'cursor-grabbing opacity-100',
        )}
        style={{ touchAction: 'none' }}
      >
        <GripIcon />
      </button>
      {children}
    </div>
  )
}

function GripIcon() {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="h-4 w-4 sm:h-3 sm:w-3"
    >
      <circle cx="3" cy="3" r="1" fill="currentColor" />
      <circle cx="9" cy="3" r="1" fill="currentColor" />
      <circle cx="3" cy="6" r="1" fill="currentColor" />
      <circle cx="9" cy="6" r="1" fill="currentColor" />
      <circle cx="3" cy="9" r="1" fill="currentColor" />
      <circle cx="9" cy="9" r="1" fill="currentColor" />
    </svg>
  )
}
