// Tiny JSON-path utility used by the sweep tool to address fields
// inside a composable strategy_definition. lodash is not in the
// dependency set so this module covers the small surface we need:
// dotted access with bracketed array indices, a non-mutating
// setter, and an existence check.
//
// Path syntax accepted:
//   "a.b.c"
//   "a.b[0].c"
//   "a.b.0.c"
//
// Numeric segments are treated as array indices when the parent
// happens to be an array; the same path against a plain object
// reads / writes a numeric-keyed property. This dual semantics is
// intentional: a sweep dimension does not need to know whether its
// parent is `groups` (array) or `metadata` (object).

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export function parsePath(path: string): string[] {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('JSON path must be a non-empty string')
  }
  const segments: string[] = []
  let current = ''
  for (let i = 0; i < path.length; i++) {
    const ch = path[i]!
    if (ch === '.') {
      if (current.length > 0) {
        segments.push(current)
        current = ''
      }
    } else if (ch === '[') {
      if (current.length > 0) {
        segments.push(current)
        current = ''
      }
      const close = path.indexOf(']', i)
      if (close === -1) {
        throw new Error(`Unclosed bracket in JSON path: ${path}`)
      }
      const inner = path.slice(i + 1, close).trim()
      if (inner.length === 0) {
        throw new Error(`Empty bracket in JSON path: ${path}`)
      }
      segments.push(inner)
      i = close
    } else {
      current += ch
    }
  }
  if (current.length > 0) segments.push(current)
  if (segments.length === 0) {
    throw new Error(`JSON path resolved to no segments: ${path}`)
  }
  return segments
}

function getByKey(parent: unknown, key: string): unknown {
  if (parent === null || parent === undefined) return undefined
  if (Array.isArray(parent)) {
    const idx = Number(key)
    if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) {
      return undefined
    }
    return parent[idx]
  }
  if (typeof parent === 'object') {
    return (parent as Record<string, unknown>)[key]
  }
  return undefined
}

export function getByPath(root: unknown, path: string): unknown {
  const segments = parsePath(path)
  let current: unknown = root
  for (const segment of segments) {
    current = getByKey(current, segment)
    if (current === undefined) return undefined
  }
  return current
}

export function hasPath(root: unknown, path: string): boolean {
  const segments = parsePath(path)
  let current: unknown = root
  for (const segment of segments) {
    if (current === null || current === undefined) return false
    if (Array.isArray(current)) {
      const idx = Number(segment)
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
        return false
      }
      current = current[idx]
    } else if (typeof current === 'object') {
      const obj = current as Record<string, unknown>
      if (!Object.prototype.hasOwnProperty.call(obj, segment)) return false
      current = obj[segment]
    } else {
      return false
    }
  }
  return true
}

// Immutable setter: every container along the path is shallow-cloned
// so the original tree is untouched. Containers stay arrays vs
// objects according to what they were in the source tree; if the
// caller targets a missing intermediate, an object is created.
export function setByPath<T>(root: T, path: string, value: unknown): T {
  const segments = parsePath(path)
  function recur(node: unknown, depth: number): unknown {
    if (depth === segments.length) return value
    const segment = segments[depth]!
    if (Array.isArray(node)) {
      const idx = Number(segment)
      if (!Number.isInteger(idx) || idx < 0) {
        throw new Error(
          `Path segment "${segment}" is not a valid array index at depth ${depth}`,
        )
      }
      const next = [...node]
      while (next.length <= idx) next.push(undefined)
      next[idx] = recur(node[idx], depth + 1)
      return next
    }
    if (node === null || node === undefined || typeof node !== 'object') {
      const fresh: Record<string, unknown> = {}
      fresh[segment] = recur(undefined, depth + 1)
      return fresh
    }
    const obj = node as Record<string, unknown>
    return {
      ...obj,
      [segment]: recur(obj[segment], depth + 1),
    }
  }
  return recur(root, 0) as T
}
