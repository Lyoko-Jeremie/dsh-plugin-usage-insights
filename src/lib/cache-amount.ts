/**
 * Billed amount composition of one conversation.
 *
 * Pure: prices the same scopes the cache-hit bars report, split by what the
 * tokens were paid for (cache read, uncached input, cache write, output). A
 * per-band rollup prices every request in the band it actually ran in; without
 * one, the cumulative buckets are priced at both bands and the lesser amount
 * is drawn, with the other supplied as the upper bound.
 */
import type { BillingBand } from '../shared/band.js'
import type {
  AmountBreakdownView, AmountSliceKey, AmountSliceView, BandModelView, CacheAmountView, ModelRef,
  PricingTable, TokenBuckets, UsageBandsView, UsageStepView,
} from '../client/contract.ts'
import { priceBucketsInBand } from './pricing.ts'

/** Fixed slice order shown in the bar and its legend. */
const SLICE_KEYS: readonly AmountSliceKey[] = ['cacheRead', 'uncachedInput', 'cacheWrite', 'output']

/**
 * Price one part of a scope's tokens in one band.
 *
 * @param key - which bucket the tokens belong to.
 * @param tokens - that bucket's count.
 * @returns the bucket with only this part populated.
 */
function sliceBuckets(key: AmountSliceKey, tokens: number): TokenBuckets {
  return {
    uncachedInputTokens: key === 'uncachedInput' ? tokens : 0,
    cacheReadTokens: key === 'cacheRead' ? tokens : 0,
    cacheWriteTokens: key === 'cacheWrite' ? tokens : 0,
    outputTokens: key === 'output' ? tokens : 0,
  }
}

/**
 * Token count of one part.
 *
 * @param key - which bucket the tokens belong to.
 * @param buckets - the four token buckets.
 * @returns that bucket's count.
 */
function sliceTokens(key: AmountSliceKey, buckets: TokenBuckets): number {
  switch (key) {
    case 'cacheRead': return buckets.cacheReadTokens
    case 'uncachedInput': return buckets.uncachedInputTokens
    case 'cacheWrite': return buckets.cacheWriteTokens
    case 'output': return buckets.outputTokens
  }
}

/** Running totals of one scope while its parts are priced. */
interface Accumulator {
  micros: Record<AmountSliceKey, number>
  tokens: Record<AmountSliceKey, number>
  unpricedTokens: number
  /** True once at least one part had a price. */
  priced: boolean
}

/**
 * A fresh accumulator.
 *
 * @returns zeroed totals in the fixed slice order.
 */
function emptyAccumulator(): Accumulator {
  const zero = (): Record<AmountSliceKey, number> => ({
    cacheRead: 0,
    uncachedInput: 0,
    cacheWrite: 0,
    output: 0,
  })
  return { micros: zero(), tokens: zero(), unpricedTokens: 0, priced: false }
}

/**
 * Add one scope's buckets to the accumulator at one band.
 *
 * Parts are priced separately, so the result's slice amounts are the same
 * per-part figures the provider bills; their sum matches pricing the whole
 * bucket set at once.
 *
 * @param acc - running totals.
 * @param pricing - plugin price table.
 * @param route - route the tokens were billed on, or null when unknown.
 * @param buckets - the scope's four buckets.
 * @param band - band the usage was billed in.
 */
function accumulate(
  acc: Accumulator,
  pricing: PricingTable,
  route: ModelRef | null,
  buckets: TokenBuckets,
  band: BillingBand,
): void {
  for (const key of SLICE_KEYS) {
    const tokens = sliceTokens(key, buckets)
    acc.tokens[key] += tokens
    if (tokens === 0) continue
    const priced = priceBucketsInBand(pricing, route, sliceBuckets(key, tokens), band)
    if (priced === null) {
      acc.unpricedTokens += tokens
      continue
    }
    acc.priced = true
    acc.micros[key] += priced.amountMicros
  }
}

/**
 * Turn an accumulator into the view the panel renders.
 *
 * @param acc - running totals.
 * @param currency - ISO 4217 code of the price table.
 * @returns the slice list and the scope total.
 */
function build(acc: Accumulator, currency: string): AmountBreakdownView {
  const slices: AmountSliceView[] = SLICE_KEYS.map(key => ({
    key,
    micros: acc.micros[key],
    tokens: acc.tokens[key],
  }))
  const micros = SLICE_KEYS.reduce((sum, key) => sum + acc.micros[key], 0)
  return {
    slices,
    micros,
    currency,
    complete: acc.unpricedTokens === 0,
    unpricedTokens: acc.unpricedTokens,
  }
}

/**
 * Attach the upper bound of a two-band range to a lower-bound view.
 *
 * The whole composition moves together: each slice's bound comes from the same
 * band set as the total, never from mixing one part's peak with another's off-peak.
 *
 * @param low - the composition drawn in the bar.
 * @param high - the same composition priced at the other band.
 * @returns the low view carrying the upper bound.
 */
function withMax(low: AmountBreakdownView, high: AmountBreakdownView): AmountBreakdownView {
  return {
    ...low,
    microsMax: high.micros,
    slices: low.slices.map((slice, index) => {
      const top = high.slices[index] ?? slice
      return top.micros === slice.micros ? slice : { ...slice, microsMax: top.micros }
    }),
  }
}

/**
 * Price cumulative buckets without a per-band rollup.
 *
 * Both bands are priced and the smaller total is drawn; the larger one becomes
 * the range's upper bound. A zero-token scope yields null so the panel can tell
 * "nothing billed" from "billed zero".
 *
 * @param pricing - plugin price table.
 * @param route - session route the cumulative counters belong to.
 * @param buckets - cumulative buckets.
 * @returns the composition, or null when it billed no tokens or stayed unpriced.
 */
function priceCumulative(
  pricing: PricingTable,
  route: ModelRef | null,
  buckets: TokenBuckets,
): AmountBreakdownView | null {
  const total = SLICE_KEYS.reduce((sum, key) => sum + sliceTokens(key, buckets), 0)
  if (total === 0) return null
  const peak = emptyAccumulator()
  const offPeak = emptyAccumulator()
  accumulate(peak, pricing, route, buckets, 'peak')
  accumulate(offPeak, pricing, route, buckets, 'off-peak')
  const peakView = peak.priced ? build(peak, pricing.currency) : null
  const offPeakView = offPeak.priced ? build(offPeak, pricing.currency) : null
  if (peakView === null) return offPeakView
  if (offPeakView === null) return peakView
  if (peakView.micros === offPeakView.micros) return peakView
  return peakView.micros < offPeakView.micros
    ? withMax(peakView, offPeakView)
    : withMax(offPeakView, peakView)
}

/**
 * Price one band's per-model entries.
 *
 * @param entries - one band's model buckets.
 * @param band - that band.
 * @param pricing - plugin price table.
 * @param fallback - route for entries the log could not attribute.
 * @param acc - running totals.
 */
function accumulateEntries(
  entries: readonly BandModelView[],
  band: BillingBand,
  pricing: PricingTable,
  fallback: ModelRef | null,
  acc: Accumulator,
): void {
  for (const entry of entries) {
    const route = entry.provider.length > 0 && entry.model.length > 0
      ? { provider: entry.provider, model: entry.model }
      : fallback
    accumulate(acc, pricing, route, {
      uncachedInputTokens: entry.uncachedInputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cacheWriteTokens: entry.cacheWriteTokens,
      outputTokens: entry.outputTokens,
    }, band)
  }
}

/**
 * Price the whole log from its per-band rollup.
 *
 * @param bands - the `usageBands` view.
 * @param pricing - plugin price table.
 * @param fallback - route for entries the log could not attribute.
 * @returns the composition, or null when every entry stayed unpriced.
 */
function priceBands(
  bands: UsageBandsView,
  pricing: PricingTable,
  fallback: ModelRef | null,
): AmountBreakdownView | null {
  const acc = emptyAccumulator()
  accumulateEntries(bands.total.peak, 'peak', pricing, fallback, acc)
  accumulateEntries(bands.total.offPeak, 'off-peak', pricing, fallback, acc)
  return acc.priced ? build(acc, pricing.currency) : null
}

/**
 * Route of one request.
 *
 * @param step - one request.
 * @returns the route, or null when the log did not name one.
 */
function routeOf(step: UsageStepView): ModelRef | null {
  return step.provider.length > 0 && step.model.length > 0
    ? { provider: step.provider, model: step.model }
    : null
}

/**
 * Buckets of one request.
 *
 * @param step - one request.
 * @returns its four buckets.
 */
function bucketsOf(step: UsageStepView): TokenBuckets {
  return {
    uncachedInputTokens: step.uncachedInputTokens,
    cacheReadTokens: step.cacheReadTokens,
    cacheWriteTokens: step.cacheWriteTokens,
    outputTokens: step.outputTokens,
  }
}

/**
 * Price one request in its own band.
 *
 * @param step - one request.
 * @param pricing - plugin price table.
 * @param fallback - route for requests the log could not attribute.
 * @returns the composition, or null when every part stayed unpriced.
 */
function priceStep(
  step: UsageStepView,
  pricing: PricingTable,
  fallback: ModelRef | null,
): AmountBreakdownView | null {
  const acc = emptyAccumulator()
  accumulate(acc, pricing, routeOf(step) ?? fallback, bucketsOf(step), step.band)
  return acc.priced ? build(acc, pricing.currency) : null
}

/**
 * Price every request of the newest turn.
 *
 * @param steps - the request window.
 * @param last - the newest request, which fixes the turn.
 * @param pricing - plugin price table.
 * @param fallback - route for requests the log could not attribute.
 * @returns the composition, or null when the turn billed nothing priceable.
 */
function priceTurn(
  steps: readonly UsageStepView[],
  last: UsageStepView,
  pricing: PricingTable,
  fallback: ModelRef | null,
): AmountBreakdownView | null {
  const acc = emptyAccumulator()
  for (const step of steps) {
    if (step.turn !== last.turn) continue
    accumulate(acc, pricing, routeOf(step) ?? fallback, bucketsOf(step), step.band)
  }
  return acc.priced ? build(acc, pricing.currency) : null
}

/**
 * Derive the billed amount composition of one conversation.
 *
 * @param pricing - plugin price table.
 * @param bands - the `usageBands` view, or null/undefined without the projection.
 * @param steps - the `usageSteps` request window, or null/undefined without it.
 * @param fallback - session route for requests the log could not attribute.
 * @param totalBuckets - cumulative buckets of the durable log.
 * @returns amount compositions for the whole log, the newest turn and the newest request.
 */
export function deriveCacheAmount(
  pricing: PricingTable,
  bands: UsageBandsView | null | undefined,
  steps: readonly UsageStepView[] | null | undefined,
  fallback: ModelRef | null,
  totalBuckets: TokenBuckets,
): CacheAmountView {
  const rows = steps ?? []
  const last = rows.at(-1)
  return {
    total: bands !== null && bands !== undefined
      ? priceBands(bands, pricing, fallback)
      : priceCumulative(pricing, fallback, totalBuckets),
    turn: last === undefined ? null : priceTurn(rows, last, pricing, fallback),
    step: last === undefined ? null : priceStep(last, pricing, fallback),
  }
}
