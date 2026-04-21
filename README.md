# Dizzy Trade

Next.js 14 App Router application built with TypeScript and Tailwind CSS.

## Getting started

```bash
# pull the latest environment variables from Vercel into .env.local
vercel env pull

# install dependencies
npm install

# run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment variables

Environment variables are managed entirely through the Vercel dashboard across the development, preview, and production environments. Vercel is the single source of truth. Do not commit a `.env`, `.env.local`, or example file to the repository.

To pull the current values into a local `.env.local`, run:

```bash
vercel env pull
```

The application expects the following variables:

| Name                            | Scope               | Purpose                                                               |
| ------------------------------- | ------------------- | --------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Public, client-safe | Supabase project URL used by the browser and server Supabase clients. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public, client-safe | Supabase anon key used by the browser and server Supabase clients.    |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server-only, secret | Privileged Supabase key. Must never be exposed to the client.         |
| `ANTHROPIC_API_KEY`             | Server-only, secret | Used for platform-owned Claude calls such as the shared news digest.  |

Variables prefixed with `NEXT_PUBLIC_` are inlined into the client bundle at build time, so only put values here that are safe for the browser to see. All other variables are only available in server-side code (route handlers, server components, server actions).

## Scripts

| Command                | Description                           |
| ---------------------- | ------------------------------------- |
| `npm run dev`          | Start the Next.js development server. |
| `npm run build`        | Create a production build.            |
| `npm run start`        | Start the production server.          |
| `npm run lint`         | Run ESLint.                           |
| `npm run format`       | Format the codebase with Prettier.    |
| `npm run format:check` | Check the codebase is Prettier-clean. |

## Project structure

```
src/
  app/              App Router routes, layouts, and pages.
  components/
    ui/             Primitive UI building blocks.
    shared/         Shared composite components used across features.
  lib/
    supabase/       Supabase client factories and helpers.
    claude/         Anthropic Claude client wrappers and helpers.
    validations/    Zod schemas shared across the app.
  types/            Shared TypeScript types.
supabase/
  migrations/       SQL migrations managed by the Supabase CLI.
```

## Tech stack

- Next.js 14 (App Router)
- React 18
- TypeScript (strict mode)
- Tailwind CSS
- Supabase (`@supabase/supabase-js`, `@supabase/ssr`)
- Anthropic Claude SDK (`@anthropic-ai/sdk`)
- Zod, date-fns, clsx, tailwind-merge
- ESLint and Prettier (no semicolons, single quotes, 2-space indent, trailing commas)
