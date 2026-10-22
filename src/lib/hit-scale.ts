/**
 * Scale and status levels for the cache-hit bars.
 *
 * Cache hits usually sit above 90%, where a linear bar hides the difference
 * between 99% and 99.9%. The bar therefore uses a power scale with an exponent
 * below one: the high end of the range keeps its spread while the low end is
 * compressed, so both a 40% miss-heavy turn and a 99.9% cached request stay
 * readable on the same bar.
 */

/** Power used by {@link hitBarRatio}; smaller values spread the high end wider. */
export const HIT_SCALE_EXPONENT = 0.3

/**
 * Reference marks on the cache-hit bars.
 *
 * Three points are enough to read the non-linear scale: half of the input
 * cached, the comfortable 90% line, and the near-full 99% line.
 */
export const HIT_TICKS = [0.5, 0.9, 0.99] as const

/** Status band of one cache-hit rate. */
export type HitLevel = 'good' | 'warn' | 'bad' | 'none'

/**
 * Map a cache-hit ratio onto the bar's width.
 *
 * @param ratio - cache reads over billed input, clamped to [0, 1].
 * @returns the filled fraction of the bar's width.
 */
export function hitBarRatio(ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio))
  return 1 - (1 - clamped) ** HIT_SCALE_EXPONENT
}

/**
 * Classify a cache-hit ratio for its status colour.
 *
 * @param ratio - cache reads over billed input, or null without usage.
 * @returns `good` at 90% and above, `warn` at 70% and above, `bad` below that.
 */
export function hitLevel(ratio: number | null): HitLevel {
  if (ratio === null) return 'none'
  if (ratio >= 0.9) return 'good'
  if (ratio >= 0.7) return 'warn'
  return 'bad'
}
