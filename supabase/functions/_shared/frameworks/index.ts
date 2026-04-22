import type { Framework } from './types.ts'
import { liquidationHuntFramework } from './liquidation_hunt.ts'

// Registered frameworks keyed by id. Adding a new framework is:
//  1. implement it in a new file exporting a Framework object
//  2. import it here and add it to this Map
// The scanner iterates the Map on every tick.
export const FRAMEWORKS: Map<string, Framework> = new Map([
  [liquidationHuntFramework.id, liquidationHuntFramework],
])
