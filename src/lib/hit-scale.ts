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

/** Smallest number of segments the ruler keeps, however narrow the track is. */
export const HIT_MIN_DIVISIONS = 2

/** Width one segment needs before the ruler splits it in half again. */
export const HIT_MIN_SEGMENT_PX = 40

/**
 * Pick how many segments the ruler should draw.
 *
 * Segment counts are powers of two, so the ruler never shows a half segment:
 * it halves every segment each time the track gains that much width again, and
 * stops at {@link HIT_MIN_DIVISIONS} on a narrow row. There is no upper bound;
 * a wider track simply keeps halving.
 *
 * @param trackWidth - available width of the ruler track, in CSS pixels.
 * @param minSegmentPx - width one segment needs to keep its label apart.
 * @returns the number of segments, a power of two no smaller than 2.
 */
export function divisionsForWidth(
  trackWidth: number,
  minSegmentPx: number = HIT_MIN_SEGMENT_PX,
): number {
  let divisions = HIT_MIN_DIVISIONS
  while (trackWidth >= divisions * 2 * minSegmentPx) divisions *= 2
  return divisions
}

/**
 * One reference mark on the cache-hit bars.
 */
export interface HitTick {
  /** Position on the track: 0 at the left edge, 1 at the right. */
  readonly width: number
  /** Cache-hit rate that fills exactly {@link width} of the bar. */
  readonly ratio: number
}

/**
 * Build the marks of an equal-length ruler.
 *
 * The track is divided into `divisions` equal lengths, and each mark prints the
 * rate that fills it. Even spacing is what makes the power scale legible: half
 * the track is a 90% hit rate, a quarter is 62%.
 *
 * @param divisions - number of equal segments to draw; 2 or more.
 * @returns one mark per segment boundary, including both track ends.
 */
export function hitTicks(divisions: number): HitTick[] {
  return Array.from({ length: divisions + 1 }, (_, index) => {
    const width = index / divisions
    return { width, ratio: hitRatioAtWidth(width) }
  })
}

/**
 * Label one cache-hit tick.
 *
 * The rate is printed to one decimal, and to two from 99.5% upward so the last
 * marks before 100% stay distinct.
 *
 * @param ratio - cache-hit rate the tick stands for.
 * @returns `"0%"`, `"45.5%"`, `"99.0%"`, `"99.97%"`, `"100%"`.
 */
export function hitTickLabel(ratio: number): string {
  if (ratio >= 1) return '100%'
  if (ratio === 0) return '0%'
  return `${(ratio * 100).toFixed(ratio >= 0.995 ? 2 : 1)}%`
}

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
 * Map a fill width back onto the cache-hit rate it displays.
 *
 * Inverse of {@link hitBarRatio}, used to label the equal segments of the
 * ruler. The two round-trip within floating-point error below
 * {@link FULL_HIT_RATIO}.
 *
 * @param width - filled fraction of the track, clamped to [0, 1].
 * @returns the cache-hit rate that fills exactly that width.
 */
export function hitRatioAtWidth(width: number): number {
  const clamped = Math.min(1, Math.max(0, width))
  if (clamped >= 1) return 1
  return 1 - (1 - clamped) ** (1 / HIT_SCALE_EXPONENT)
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
