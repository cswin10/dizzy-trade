import { SignUpForm } from './sign-up-form'
import { StatusDot } from '@/components/ui/StatusDot'

export const metadata = {
  title: 'Create account · Dizzy Trade',
}

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-4 flex items-center gap-2 text-[11px] uppercase tracking-widest text-light/40">
        <StatusDot />
        <span>Dizzy Trade</span>
      </div>
      <div className="w-full max-w-[420px] border border-light/10 bg-navy-deep p-8 sm:p-10">
        <header className="mb-6 flex flex-col gap-1">
          <h1 className="text-xs font-medium uppercase tracking-widest text-light/60">
            Create account
          </h1>
          <p className="text-sm text-light/40">Start your trading dashboard</p>
        </header>
        <SignUpForm />
      </div>
    </main>
  )
}
