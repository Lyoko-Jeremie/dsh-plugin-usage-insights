/**
 * Logarithmic scale for the context-occupancy curve.
 *
 * Occupancy usually moves in the low end: the first few steps climb from a
 * small prompt to a few tens of percent, while the high end rarely changes.
 * A linear axis spends most of its height on the 50–100% band and squeezes the
 * early steps together. The curve therefore maps a ratio through
 * `log10(1 + 9 * ratio)`: 0–50% takes about three quarters of the plot, 0–25%
 * about half, and every further doubling of occupancy keeps a smaller step.
 * The high end is compressed instead, which is the price of reading the early
 * requests at all.
 */

/** Value that turns the 1..10 decade into a 0..1 occupancy range. */
export const CONTEXT_SCALE_KNEE = 9

/**
 * Map a context occupancy onto the plot height.
 *
 * @param ratio - used tokens over the declared capacity, clamped to [0, 1].
 * @returns the fraction of the plot height, 0 at the bottom and 1 at the top.
 */
export function contextBarRatio(ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio))
  return Math.log10(1 + CONTEXT_SCALE_KNEE * clamped) / Math.log10(1 + CONTEXT_SCALE_KNEE)
}

/**
 * Map a plot height back onto the occupancy it displays.
 *
 * Inverse of {@link contextBarRatio}, used to place the axis ticks.
 *
 * @param height - fraction of the plot height, clamped to [0, 1].
 * @returns the occupancy that sits exactly at that height.
 */
export function contextRatioAtHeight(height: number): number {
  const clamped = Math.min(1, Math.max(0, height))
  return (10 ** (clamped * Math.log10(1 + CONTEXT_SCALE_KNEE)) - 1) / CONTEXT_SCALE_KNEE
}
