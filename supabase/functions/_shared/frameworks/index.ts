import type { Framework } from './types.ts'
import { liquidationHuntFramework } from './liquidation_hunt.ts'
import { narrativeBreakoutFramework } from './narrative_breakout.ts'
import { meanReversionFramework } from './mean_reversion.ts'
import { simpleRsiFramework } from './simple_rsi.ts'

// Registered frameworks keyed by id. Adding a new framework is:
//  1. implement it in a new file exporting a Framework object
//  2. import it here and add it to this Map
// The scanner iterates the Map on every tick.
export const FRAMEWORKS: Map<string, Framework> = new Map([
  [narrativeBreakoutFramework.id, narrativeBreakoutFramework],
  [meanReversionFramework.id, meanReversionFramework],
  [liquidationHuntFramework.id, liquidationHuntFramework],
  [simpleRsiFramework.id, simpleRsiFramework],
])
