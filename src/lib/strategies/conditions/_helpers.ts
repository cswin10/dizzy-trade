// Shared bits for the condition library. Keeping the comparator
// helpers here means each condition file stays focused on its own
// indicator and parameter shape rather than reimplementing the
// same six lines of switch.

import { z } from 'zod'

export const comparatorAllSchema = z.enum(['lt', 'lte', 'gt', 'gte'])
export type ComparatorAll = z.infer<typeof comparatorAllSchema>

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
