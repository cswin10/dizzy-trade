import type { Framework } from './types'
import { liquidationHuntFramework } from './liquidation_hunt'
import { meanReversionFramework } from './mean_reversion'
import { narrativeBreakoutFramework } from './narrative_breakout'

export type { Framework, FrameworkResult, MarketSnapshot } from './types'

// Same registry as supabase/functions/_shared/frameworks/index.ts.
// Watchlist evaluates every framework against every pair so the
// readiness chips can show what is firing across the board, not just
// the active strategy's framework.
export const FRAMEWORKS: Map<string, Framework> = new Map([
  [narrativeBreakoutFramework.id, narrativeBreakoutFramework],
  [meanReversionFramework.id, meanReversionFramework],
  [liquidationHuntFramework.id, liquidationHuntFramework],
])

export const FRAMEWORK_ORDER = [
  'mean_reversion_v1',
  'narrative_breakout_v1',
  'liquidation_hunt_v1',
] as const
