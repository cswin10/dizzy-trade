'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { signInSchema, signUpSchema } from '@/lib/validations/auth'

export type AuthActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' }

function firstMessage(errors: Record<string, string[] | undefined>): string {
  for (const key of Object.keys(errors)) {
    const list = errors[key]
    if (list && list.length > 0 && list[0]) return list[0]
  }
  return 'Invalid input'
}

function originFromHeaders(): string {
  const h = headers()
  const origin = h.get('origin')
  if (origin) return origin
  const host = h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  return host ? `${proto}://${host}` : ''
}

export async function signInAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return {
      status: 'error',
      message: firstMessage(parsed.error.flatten().fieldErrors),
    }
  }

  const supabase = createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) {
    // Supabase returns "Invalid login credentials" for both wrong password
    // and unconfirmed email. Surface the string directly; it is already
    // user-facing.
    return { status: 'error', message: error.message }
  }

  redirect('/dashboard')
}

export async function signUpAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return {
      status: 'error',
      message: firstMessage(parsed.error.flatten().fieldErrors),
    }
  }

  const supabase = createClient()
  const origin = originFromHeaders()
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: origin ? `${origin}/auth/callback` : undefined,
    },
  })
  if (error) {
    return { status: 'error', message: error.message }
  }

  return { status: 'success' }
}
