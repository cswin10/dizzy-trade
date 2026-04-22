import { SignInForm } from './sign-in-form'

export const metadata = {
  title: 'Sign in · Dizzy Trade',
}

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-5 flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_rgba(59,130,255,0.6)]"
        />
        <span className="text-sm font-medium tracking-tight text-white/70">
          Dizzy Trade
        </span>
      </div>
      <div className="w-full max-w-[420px] rounded-lg border border-white/[0.06] bg-surface bg-panel-lit p-8 sm:p-10">
        <header className="mb-6 flex flex-col gap-1.5">
          <h1 className="text-xl font-medium tracking-tight text-white">
            Welcome back
          </h1>
          <p className="text-sm text-white/45">Access your trading dashboard</p>
        </header>
        <SignInForm />
      </div>
    </main>
  )
}
