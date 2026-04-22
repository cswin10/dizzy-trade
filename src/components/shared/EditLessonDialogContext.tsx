'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useFormState, useFormStatus } from 'react-dom'

import { editLessonAction } from '@/app/actions/trade'
import {
  initialTradeActionState,
  type TradeActionState,
} from '@/app/actions/trade-types'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { StatusDot } from '@/components/ui/StatusDot'
import { Textarea } from '@/components/ui/Textarea'

export type EditLessonTarget = {
  trade_id: string
  asset_symbol?: string
  lesson?: string | null
}

type Ctx = {
  openEditLesson: (target: EditLessonTarget) => void
  close: () => void
}

const EditLessonDialogContext = createContext<Ctx | null>(null)

export function useEditLessonDialog(): Ctx {
  const ctx = useContext(EditLessonDialogContext)
  if (!ctx) {
    throw new Error(
      'useEditLessonDialog must be used within an EditLessonDialogProvider',
    )
  }
  return ctx
}

function LessonSubmit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-auto px-4">
      {pending ? (
        <>
          <StatusDot tone="accent" pulse />
          <span>Saving</span>
        </>
      ) : (
        <span>Save lesson</span>
      )}
    </Button>
  )
}

export function EditLessonDialogProvider({
  children,
}: {
  children: ReactNode
}) {
  const [target, setTarget] = useState<EditLessonTarget | null>(null)
  const [state, formAction] = useFormState<TradeActionState, FormData>(
    editLessonAction,
    initialTradeActionState,
  )

  const close = useCallback(() => setTarget(null), [])
  const openEditLesson = useCallback((next: EditLessonTarget) => {
    setTarget(next)
  }, [])

  useEffect(() => {
    if (state.status === 'success') close()
  }, [state, close])

  const value = useMemo<Ctx>(
    () => ({ openEditLesson, close }),
    [openEditLesson, close],
  )

  return (
    <EditLessonDialogContext.Provider value={value}>
      {children}
      <Dialog
        open={Boolean(target)}
        onClose={close}
        title={
          target?.asset_symbol
            ? `Edit lesson · ${target.asset_symbol}`
            : 'Edit lesson'
        }
        description="Capture what you learned from this trade."
      >
        {target ? (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="trade_id" value={target.trade_id} />
            <Textarea
              name="lesson"
              rows={4}
              defaultValue={target.lesson ?? ''}
              placeholder="What did you learn?"
            />
            {state.status === 'error' ? (
              <p className="text-sm text-negative">{state.message}</p>
            ) : null}
            <div className="flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                className="w-auto px-4"
                onClick={close}
              >
                Cancel
              </Button>
              <LessonSubmit />
            </div>
          </form>
        ) : null}
      </Dialog>
    </EditLessonDialogContext.Provider>
  )
}
