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
          <StatusDot tone="accent" pulse />
          <span>Signing in</span>
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
        <div className="rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
          <span className="font-medium">Error</span>
          <span className="text-negative/80"> · {state.message}</span>
        </div>
      ) : null}
      <SubmitButton />
      <div className="flex items-center justify-center gap-1.5 text-sm text-white/55">
        <span>No account?</span>
        <Link
          href="/sign-up"
          className="text-accent transition-colors duration-200 hover:text-accent/80"
        >
          Create one
        </Link>
      </div>
    </form>
  )
}
