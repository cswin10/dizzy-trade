// Env vars are managed in Vercel. Run `vercel env pull` to refresh local values.
// Never import the server env object from client components.
import { z } from 'zod'

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
})

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  // Optional: shared secret that gates the one-off admin seed endpoint at
  // /api/admin/seed-assets. Left unset in environments that should never
  // accept a seed request.
  SEED_TOKEN: z.string().min(16).optional(),
})

export type ClientEnv = z.infer<typeof clientSchema>
export type ServerEnv = z.infer<typeof serverSchema>

function formatMessage(
  scope: 'client' | 'server',
  result: z.SafeParseError<unknown>,
): string {
  const names = result.error.issues
    .map((issue) => issue.path.join('.') || issue.message)
    .join(', ')
  return [
    `Missing or invalid ${scope} environment variable(s): ${names}.`,
    'Env vars are managed in Vercel. Run `vercel env pull` to refresh local',
    'values, or update them in the Vercel project settings under Settings >',
    'Environment Variables (development, preview, production).',
  ].join(' ')
}

function parseClientEnv(): ClientEnv {
  const result = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })
  if (!result.success) throw new Error(formatMessage('client', result))
  return result.data
}

function parseServerEnv(): ServerEnv {
  const result = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    SEED_TOKEN: process.env.SEED_TOKEN,
  })
  if (!result.success) throw new Error(formatMessage('server', result))
  return result.data
}

const isServer = typeof window === 'undefined'

export const clientEnv: ClientEnv = parseClientEnv()

// On the server we validate eagerly so misconfiguration surfaces at startup.
// On the client this Proxy prevents accidental access to server-only secrets:
// if a client component imports `env`, it will throw at access time with a
// message pointing at the offending property.
export const env: ServerEnv = isServer
  ? parseServerEnv()
  : (new Proxy({} as ServerEnv, {
      get(_target, key) {
        throw new Error(
          `Tried to read server env "${String(key)}" from a client bundle. ` +
            'Import `clientEnv` instead, or move this code to a server module.',
        )
      },
    }) as ServerEnv)
