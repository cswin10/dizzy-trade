'use client'

import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'

import { signInAction, type AuthActionState } from '@/app/actions/auth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { StatusDot } from '@/components/ui/StatusDot'

const initialState: AuthActionState = { status: 'idle' }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <StatusDot pulse />
          <span>Signing in…</span>
        </>
      ) : (
        <span>Sign in</span>
      )}
    </Button>
  )
}

export function SignInForm() {
  const [state, formAction] = useFormState(signInAction, initialState)

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
      />
      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        minLength={8}
        required
      />
      {state.status === 'error' ? (
        <p className="text-xs uppercase tracking-widest text-danger">
          <span className="font-semibold">Error ·</span>{' '}
          <span className="normal-case tracking-normal">{state.message}</span>
        </p>
      ) : null}
      <SubmitButton />
      <div className="flex items-center justify-center gap-2 text-[11px] uppercase tracking-widest text-light/40">
        <span>No account?</span>
        <Link href="/sign-up" className="text-accent hover:text-accent-hover">
          Create one
        </Link>
      </div>
    </form>
  )
}
