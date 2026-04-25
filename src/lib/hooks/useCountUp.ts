'use client'

import { useEffect, useRef, useState } from 'react'

export type UseCountUpOptions = {
  // Duration of the interpolation in milliseconds.
  duration?: number
}

const DEFAULT_DURATION_MS = 400

/**
 * Smoothly interpolates a numeric value over a short duration when
 * the target changes. Returns the current intermediate value to
 * render. Snaps to the target when the durations are 0 or shorter
 * than one animation frame.
 */
export function useCountUp(
  target: number,
  options?: UseCountUpOptions,
): number {
  const duration = options?.duration ?? DEFAULT_DURATION_MS
  const [value, setValue] = useState(target)
  const frameRef = useRef<number | null>(null)
  const startRef = useRef<number>(0)
  const fromRef = useRef<number>(target)
  const toRef = useRef<number>(target)

  useEffect(() => {
    if (!Number.isFinite(target)) {
      setValue(target)
      return
    }
    if (target === toRef.current && target === value) return

    fromRef.current = value
    toRef.current = target
    startRef.current = performance.now()

    const tick = (now: number) => {
      const elapsed = now - startRef.current
      const t = duration <= 0 ? 1 : Math.min(1, elapsed / duration)
      const next = fromRef.current + (toRef.current - fromRef.current) * t
      setValue(next)
      if (t < 1) {
        frameRef.current = window.requestAnimationFrame(tick)
      } else {
        frameRef.current = null
      }
    }
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    frameRef.current = window.requestAnimationFrame(tick)

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration])

  return value
}
