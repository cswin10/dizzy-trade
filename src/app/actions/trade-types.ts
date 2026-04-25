// Shared client-safe types for trade server actions. Kept separate from
// `trade.ts` because that file has `'use server'` at the top, which only
// permits async function exports at runtime.

import type { RuleViolation } from '@/lib/rules'

export type TradeActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string; violations?: RuleViolation[] }
  | { status: 'success'; warnings?: RuleViolation[] }

export const initialTradeActionState: TradeActionState = { status: 'idle' }
