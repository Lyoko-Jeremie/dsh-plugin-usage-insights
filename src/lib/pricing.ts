/**
 * Token pricing for the usage panel.
 *
 * Prices are plugin-owned configuration: the Harness reports token counts, not
 * money. Amounts accumulate as integer micro units (`tokens 脳 ratePerMillion`
 * is already micro units) so sums stay exact.
 *
 * A provider may publish two billing bands (peak and off-peak). A cumulative
 * usage total cannot be attributed to the band each request actually ran in,
 * so a two-band table yields an amount range: every token priced off-peak is
 * the lower bound, every token priced at peak is the upper bound. The panel
 * shows that range rather than one fabricated number, and no band's rate is
 * ever applied to a token the route could not price.
 */
import type { BillingBand } from '../shared/band.js'
import type {
  CostView, ModelRef, PriceRates, PricingTable, TokenBuckets,
} from '../client/contract.ts'

/** A matched price row: the flat rates plus an optional off-peak band. */
type RateCard = PriceRates & { offPeak?: PriceRates }

/**
 * Price the four token buckets of one route.
 *
 * Matches an exact `(provider, model)` entry first, then a model-only entry,
 * then `table.fallback`. A route with no matching entry and no fallback is
 * unpriced and yields null, never a zero amount.
 *
 * @param table - plugin price table.
 * @param model - route the buckets were billed on, or null when unknown.
 * @param buckets - the four provider token buckets.
 * @returns priced cost view, or null when no price applies to the route.
 */
export function priceBuckets(table: PricingTable, model: ModelRef | null, buckets: TokenBuckets): CostView | null {
  const card = resolveCard(table, model)
  if (card === null) return null
  const peak = amountMicros(card, buckets)
  const offPeak = card.offPeak === undefined ? undefined : amountMicros(card.offPeak, buckets)
  const low = offPeak === undefined ? peak : Math.min(offPeak, peak)
  const high = offPeak === undefined ? undefined : Math.max(offPeak, peak)
  const totalTokens = sumBuckets(buckets)
  return {
    amountMicros: low,
    ...(high === undefined || high === low ? {} : { amountMicrosMax: high }),
    currency: table.currency,
    pricedTokens: totalTokens,
    totalTokens,
    complete: true,
  }
}

/**
 * Price the four token buckets of one route at one known billing band.
 *
 * Use this when the band of the request is known (a step start, or a per-band
 * rollup); it yields one amount instead of a range.
 *
 * @param table - plugin price table.
 * @param model - route the buckets were billed on, or null when unknown.
 * @param buckets - the four provider token buckets.
 * @param band - the band the usage was billed in.
 * @returns priced cost view, or null when no price applies to the route.
 */
export function priceBucketsInBand(
  table: PricingTable,
  model: ModelRef | null,
  buckets: TokenBuckets,
  band: BillingBand,
): CostView | null {
  const card = resolveCard(table, model)
  if (card === null) return null
  const rates = band === 'peak' ? card : (card.offPeak ?? card)
  const totalTokens = sumBuckets(buckets)
  return {
    amountMicros: amountMicros(rates, buckets),
    currency: table.currency,
    pricedTokens: totalTokens,
    totalTokens,
    complete: true,
  }
}

/**
 * Pick the most specific price row for a route.
 *
 * @param table - plugin price table.
 * @param model - route to price, or null when the caller does not know it.
 * @returns the matched card, or null when nothing (not even the fallback) applies.
 */
function resolveCard(table: PricingTable, model: ModelRef | null): RateCard | null {
  if (model !== null) {
    const exact = table.prices.find(
      entry => entry.provider !== undefined && entry.provider === model.provider && entry.model === model.model,
    )
    if (exact !== undefined) return exact
    const byModel = table.prices.find(entry => entry.provider === undefined && entry.model === model.model)
    if (byModel !== undefined) return byModel
  }
  return table.fallback ?? null
}

/**
 * Sum the four buckets at one band's rates.
 *
 * Each bucket rounds to whole micro units before summing, matching the
 * provider's per-bucket billing lines rather than rounding one blended total.
 *
 * @param rates - one band's per-million-token rates.
 * @param buckets - provider token buckets.
 * @returns the amount in micro units.
 */
function amountMicros(rates: PriceRates, buckets: TokenBuckets): number {
  return (
    Math.round(buckets.uncachedInputTokens * rates.input) +
    Math.round(buckets.cacheReadTokens * rates.cacheRead) +
    Math.round(buckets.cacheWriteTokens * rates.cacheWrite) +
    Math.round(buckets.outputTokens * rates.output)
  )
}

/**
 * Sum the four token buckets of a usage value.
 *
 * @param buckets - provider token buckets.
 * @returns their total token count.
 */
function sumBuckets(buckets: TokenBuckets): number {
  return (
    buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens
  )
}

/**
 * Merge two cost views into one aggregate.
 *
 * A null side contributes no tokens and no amount, but it also marks the merge
 * incomplete: null means that usage could not be priced. When both sides exist,
 * the result keeps the left currency and is complete only when both sides were
 * complete in the same currency. Bounds sum independently, so a range stays a
 * range.
 *
 * @param left - first cost view, or null.
 * @param right - second cost view, or null.
 * @returns merged view, or null when both sides are null.
 */
export function mergeCosts(left: CostView | null, right: CostView | null): CostView | null {
  if (left === null) return right === null ? null : { ...right, complete: false }
  if (right === null) return { ...left, complete: false }
  const hasRange = left.amountMicrosMax !== undefined || right.amountMicrosMax !== undefined
  return {
    amountMicros: left.amountMicros + right.amountMicros,
    ...(hasRange
      ? { amountMicrosMax: (left.amountMicrosMax ?? left.amountMicros) + (right.amountMicrosMax ?? right.amountMicros) }
      : {}),
    currency: left.currency,
    pricedTokens: left.pricedTokens + right.pricedTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    complete: left.complete && right.complete && left.currency === right.currency,
  }
}
