/**
 * Token pricing for the usage panel.
 *
 * Prices are plugin-owned configuration: the Harness reports token counts, not
 * money. Amounts accumulate as integer micro units (`tokens × ratePerMillion`
 * is already micro units) so sums stay exact and never drift in floating point.
 */
import type { CostView, ModelRef, PriceEntry, PricingTable, TokenBuckets } from '../client/contract.ts'

/** A resolved price row, without the route fields used to find it. */
type PriceRates = Omit<PriceEntry, 'model' | 'provider'>

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
  const rates = resolveRates(table, model)
  if (rates === null) return null
  const totalTokens = sumBuckets(buckets)
  const amountMicros =
    Math.round(buckets.uncachedInputTokens * rates.input) +
    Math.round(buckets.cacheReadTokens * rates.cacheRead) +
    Math.round(buckets.cacheWriteTokens * rates.cacheWrite) +
    Math.round(buckets.outputTokens * rates.output)
  return {
    amountMicros,
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
 * @returns the matching rates, or null when nothing (not even the fallback) applies.
 */
function resolveRates(table: PricingTable, model: ModelRef | null): PriceRates | null {
  if (model !== null) {
    const exact = table.prices.find(
      (entry) => entry.provider !== undefined && entry.provider === model.provider && entry.model === model.model,
    )
    if (exact !== undefined) return exact
    const byModel = table.prices.find((entry) => entry.provider === undefined && entry.model === model.model)
    if (byModel !== undefined) return byModel
  }
  return table.fallback ?? null
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
 * complete in the same currency.
 *
 * @param left - first cost view, or null.
 * @param right - second cost view, or null.
 * @returns merged view, or null when both sides are null.
 */
export function mergeCosts(left: CostView | null, right: CostView | null): CostView | null {
  if (left === null) return right === null ? null : { ...right, complete: false }
  if (right === null) return { ...left, complete: false }
  return {
    amountMicros: left.amountMicros + right.amountMicros,
    currency: left.currency,
    pricedTokens: left.pricedTokens + right.pricedTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    complete: left.complete && right.complete && left.currency === right.currency,
  }
}
