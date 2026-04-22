'use client'

import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'

import { signUpAction, type AuthActionState } from '@/app/actions/auth'
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
          <span>Creating account</span>
        </>
      ) : (
        <span>Create account</span>
      )}
    </Button>
  )
}

export function SignUpForm() {
  const [state, formAction] = useFormState(signUpAction, initialState)

  if (state.status === 'success') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-positive/30 bg-positive/10 p-4">
        <div className="flex items-center gap-2 text-sm text-positive">
          <StatusDot tone="positive" />
          <span className="font-medium">Check your email</span>
        </div>
        <p className="text-sm text-white/70">
          We sent a confirmation link to your inbox. Click it to confirm your
          account, then sign in.
        </p>
        <div className="pt-1 text-sm text-white/55">
          <Link
            href="/sign-in"
            className="text-accent transition-colors duration-200 hover:text-accent/80"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

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
        autoComplete="new-password"
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
        <span>Have an account?</span>
        <Link
          href="/sign-in"
          className="text-accent transition-colors duration-200 hover:text-accent/80"
        >
          Sign in
        </Link>
      </div>
    </form>
  )
}
