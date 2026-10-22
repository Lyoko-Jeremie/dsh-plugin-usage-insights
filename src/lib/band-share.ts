/**
 * Peak/off-peak proportions, shared by the conversation panel and the history
 * aggregation.
 *
 * A share is only meaningful where a band rollup exists: cumulative counters
 * cannot be attributed to a band. Callers therefore treat `null` as "no band
 * data", never as zero.
 */
import type { BandModelView, BandShareView, UsageBandsView } from '../client/contract.ts'

/**
 * Split one rollup's lifetime counters by billing band.
 *
 * @param bands - per-day, per-band rollup, or undefined.
 * @returns the share, or null when the rollup carries no requests.
 */
export function bandShareOf(bands: UsageBandsView | undefined | null): BandShareView | null {
  if (bands === undefined || bands === null) return null
  const share = emptyBandShare()
  for (const entry of bands.total.peak) addBandEntry(share, entry, 'peak')
  for (const entry of bands.total.offPeak) addBandEntry(share, entry, 'offPeak')
  return share.peakRequests + share.offPeakRequests > 0 ? share : null
}

/**
 * Create a zeroed share.
 *
 * @returns zeroed counters.
 */
export function emptyBandShare(): BandShareView {
  return { peakTokens: 0, offPeakTokens: 0, peakRequests: 0, offPeakRequests: 0 }
}

/**
 * Add one model entry into a share.
 *
 * @param target - mutable share.
 * @param entry - one model's counters inside one band.
 * @param band - the band those counters belong to.
 */
export function addBandEntry(target: BandShareView, entry: BandModelView, band: 'peak' | 'offPeak'): void {
  const tokens =
    entry.uncachedInputTokens + entry.cacheReadTokens + entry.cacheWriteTokens + entry.outputTokens
  if (band === 'peak') {
    target.peakTokens += tokens
    target.peakRequests += entry.requests
    return
  }
  target.offPeakTokens += tokens
  target.offPeakRequests += entry.requests
}

/**
 * Add one share into another.
 *
 * @param target - mutable accumulator.
 * @param source - share to add.
 */
export function addBandShare(target: BandShareView, source: BandShareView): void {
  target.peakTokens += source.peakTokens
  target.offPeakTokens += source.offPeakTokens
  target.peakRequests += source.peakRequests
  target.offPeakRequests += source.offPeakRequests
}

/**
 * Peak share by tokens, falling back to requests when the rollup has no tokens.
 *
 * @param share - band split.
 * @returns a ratio in [0, 1], or null when the share carries no data.
 */
export function peakTokenShare(share: BandShareView | null): number | null {
  if (share === null) return null
  const total = share.peakTokens + share.offPeakTokens
  if (total > 0) return share.peakTokens / total
  const requests = share.peakRequests + share.offPeakRequests
  return requests > 0 ? share.peakRequests / requests : null
}

/**
 * Peak share by requests.
 *
 * @param share - band split.
 * @returns a ratio in [0, 1], or null when the share carries no requests.
 */
export function peakRequestShare(share: BandShareView | null): number | null {
  if (share === null) return null
  const requests = share.peakRequests + share.offPeakRequests
  return requests > 0 ? share.peakRequests / requests : null
}
