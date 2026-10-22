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
 * Lowest rate whose three-decimal label reads as 100%.
 *
 * The label keeps three decimals near the top, so a fill that stopped short of
 * the bar's end would contradict a "100.000%" figure. From this rate upward the
 * bar therefore fills completely.
 */
export const FULL_HIT_RATIO = 0.9999995

/**
 * Reference marks on the cache-hit bars.
 *
 * Six points make the non-linear spacing visible: the gaps shrink toward the
 * top, so the bar cannot be read as a linear percentage axis. The marks cover
 * the usual 50–99.9% band while keeping every label apart on the track.
 */
export const HIT_TICKS = [0.5, 0.7, 0.85, 0.95, 0.99, 0.999] as const

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
  if (clamped >= FULL_HIT_RATIO) return 1
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
