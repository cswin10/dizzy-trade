// Shared comparator bits for the condition library. Mirrors the
// Node version (src/lib/strategies/conditions/_helpers.ts) but
// drops the zod dependency: at scanner runtime the strategy
// definition has already been validated by the application server,
// so we only need the runtime comparator function here.

export type ComparatorAll = 'lt' | 'lte' | 'gt' | 'gte'

export function compareAll(
  left: number,
  comparator: ComparatorAll,
  right: number,
): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false
  switch (comparator) {
    case 'lt':
      return left < right
    case 'lte':
      return left <= right
    case 'gt':
      return left > right
    case 'gte':
      return left >= right
  }
}
