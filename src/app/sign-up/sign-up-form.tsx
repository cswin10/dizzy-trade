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
          <StatusDot pulse />
          <span>Creating account…</span>
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
      <div className="flex flex-col gap-3 border border-teal/40 bg-teal/5 p-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-teal">
          <StatusDot />
          <span className="font-semibold">Check your email</span>
        </div>
        <p className="text-sm text-light/70">
          We sent a confirmation link to your inbox. Click it to activate your
          account and then sign in.
        </p>
        <div className="flex items-center gap-2 pt-2 text-[11px] uppercase tracking-widest text-light/40">
          <Link href="/sign-in" className="text-accent hover:text-accent-hover">
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
        <p className="text-xs uppercase tracking-widest text-danger">
          <span className="font-semibold">Error ·</span>{' '}
          <span className="normal-case tracking-normal">{state.message}</span>
        </p>
      ) : null}
      <SubmitButton />
      <div className="flex items-center justify-center gap-2 text-[11px] uppercase tracking-widest text-light/40">
        <span>Have an account?</span>
        <Link href="/sign-in" className="text-accent hover:text-accent-hover">
          Sign in
        </Link>
      </div>
    </form>
  )
}
