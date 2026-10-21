import { describe, expect, it } from 'vitest'
import type { CostView, PricingTable, TokenBuckets } from '../src/client/contract.ts'
import { mergeCosts, priceBuckets } from '../src/lib/pricing.ts'

/** Token buckets with every unspecified bucket left at zero. */
function tokens(partial: Partial<TokenBuckets> = {}): TokenBuckets {
  return {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...partial,
  }
}

/** One full million tokens in every bucket; makes rate arithmetic readable. */
const oneMillionEach = tokens({
  uncachedInputTokens: 1_000_000,
  cacheReadTokens: 1_000_000,
  cacheWriteTokens: 1_000_000,
  outputTokens: 1_000_000,
})

const table: PricingTable = {
  currency: 'USD',
  prices: [
    { provider: 'alpha', model: 'chat', input: 1, cacheRead: 2, cacheWrite: 3, output: 4 },
    { model: 'chat', input: 10, cacheRead: 20, cacheWrite: 30, output: 40 },
    { provider: 'beta', model: 'solo', input: 5, cacheRead: 6, cacheWrite: 7, output: 8 },
  ],
  fallback: { input: 0.5, cacheRead: 1.5, cacheWrite: 2.5, output: 3.5 },
}

const bareTable: PricingTable = {
  currency: 'EUR',
  prices: [{ model: 'chat', input: 1, cacheRead: 1, cacheWrite: 1, output: 1 }],
}

/** Build a cost view for merge tests. */
function costView(
  amountMicros: number,
  currency: string,
  pricedTokens: number,
  totalTokens: number,
  complete: boolean,
): CostView {
  return { amountMicros, currency, pricedTokens, totalTokens, complete }
}

describe('priceBuckets', () => {
  it('prices an exact provider and model match', () => {
    const cost = priceBuckets(table, { provider: 'alpha', model: 'chat' }, oneMillionEach)
    expect(cost).toEqual({
      amountMicros: 10_000_000,
      currency: 'USD',
      pricedTokens: 4_000_000,
      totalTokens: 4_000_000,
      complete: true,
    })
  })

  it('prefers the exact provider match over a model-only entry', () => {
    expect(priceBuckets(table, { provider: 'alpha', model: 'chat' }, oneMillionEach)?.amountMicros).toBe(
      10_000_000,
    )
    // The model-only entry for the same model would price the buckets at 100 USD.
    expect(priceBuckets(table, { provider: 'gamma', model: 'chat' }, oneMillionEach)?.amountMicros).toBe(
      100_000_000,
    )
  })

  it('falls back to the table fallback for an unknown route', () => {
    const cost = priceBuckets(table, { provider: 'alpha', model: 'unknown' }, oneMillionEach)
    expect(cost).toEqual({
      amountMicros: 8_000_000,
      currency: 'USD',
      pricedTokens: 4_000_000,
      totalTokens: 4_000_000,
      complete: true,
    })
  })

  it('prices a null route with the fallback', () => {
    expect(priceBuckets(table, null, oneMillionEach)?.amountMicros).toBe(8_000_000)
    expect(priceBuckets(table, null, oneMillionEach)?.complete).toBe(true)
  })

  it('returns null when no price and no fallback match', () => {
    expect(priceBuckets(bareTable, { provider: 'any', model: 'unknown' }, oneMillionEach)).toBeNull()
    expect(priceBuckets(bareTable, null, oneMillionEach)).toBeNull()
  })

  it('prices a known model without a provider entry', () => {
    const cost = priceBuckets(bareTable, { provider: 'any', model: 'chat' }, tokens({ outputTokens: 5 }))
    expect(cost).toEqual({
      amountMicros: 5,
      currency: 'EUR',
      pricedTokens: 5,
      totalTokens: 5,
      complete: true,
    })
  })

  it('prices empty buckets at zero when the route is known', () => {
    expect(priceBuckets(bareTable, { provider: 'any', model: 'chat' }, tokens())).toEqual({
      amountMicros: 0,
      currency: 'EUR',
      pricedTokens: 0,
      totalTokens: 0,
      complete: true,
    })
  })

  it('rounds each bucket to whole micro units before summing', () => {
    const halfRate: PricingTable = {
      currency: 'USD',
      prices: [{ model: 'tiny', input: 0.5, cacheRead: 0.5, cacheWrite: 0.5, output: 0.5 }],
    }
    const model = { provider: 'any', model: 'tiny' }
    // Each 1-token bucket is 0.5 micro; per-bucket rounding yields 1 + 1 + 1 = 3,
    // while rounding only the summed 1.5 would yield 2.
    expect(
      priceBuckets(halfRate, model, tokens({ uncachedInputTokens: 1, cacheReadTokens: 1, outputTokens: 1 }))
        ?.amountMicros,
    ).toBe(3)
    expect(priceBuckets(halfRate, model, tokens({ outputTokens: 5 }))?.amountMicros).toBe(3)
  })
})

describe('mergeCosts', () => {
  it('returns null when both sides are null', () => {
    expect(mergeCosts(null, null)).toBeNull()
  })

  it('marks a merged unpriced side incomplete', () => {
    const priced = costView(100, 'USD', 10, 10, true)
    expect(mergeCosts(null, priced)).toEqual(costView(100, 'USD', 10, 10, false))
    expect(mergeCosts(priced, null)).toEqual(costView(100, 'USD', 10, 10, false))
  })

  it('sums two complete views in the same currency', () => {
    const merged = mergeCosts(costView(100, 'USD', 10, 10, true), costView(250, 'USD', 20, 25, true))
    expect(merged).toEqual(costView(350, 'USD', 30, 35, true))
  })

  it('stays incomplete when either side is incomplete', () => {
    const merged = mergeCosts(costView(100, 'USD', 10, 10, true), costView(250, 'USD', 20, 25, false))
    expect(merged?.complete).toBe(false)
    expect(merged?.amountMicros).toBe(350)
  })

  it('stays incomplete across different currencies and keeps the left currency', () => {
    const merged = mergeCosts(costView(100, 'USD', 10, 10, true), costView(250, 'EUR', 20, 25, true))
    expect(merged).toEqual(costView(350, 'USD', 30, 35, false))
  })
})
