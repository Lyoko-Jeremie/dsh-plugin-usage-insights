import { describe, expect, it } from 'vitest'
import type { CostView, PricingTable, TokenBuckets } from '../src/client/contract.ts'
import { PRICING } from '../src/client/config.ts'
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

/** One million tokens in every bucket. */
const oneMillionEach = tokens({
  uncachedInputTokens: 1_000_000,
  cacheReadTokens: 1_000_000,
  cacheWriteTokens: 1_000_000,
  outputTokens: 1_000_000,
})

/** A two-band table where off-peak is exactly half of peak. */
const twoBand: PricingTable = {
  currency: 'CNY',
  prices: [{
    model: 'flash',
    input: 2,
    cacheRead: 0.04,
    cacheWrite: 2,
    output: 8,
    offPeak: { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
  }],
}

describe('priceBuckets with two billing bands', () => {
  it('reports the off-peak amount as the lower bound and peak as the upper', () => {
    // Peak: 2 + 0.04 + 2 + 8 = 12.04 CNY; off-peak is half.
    const cost = priceBuckets(twoBand, { provider: 'any', model: 'flash' }, oneMillionEach)
    expect(cost?.amountMicros).toBe(6_020_000)
    expect(cost?.amountMicrosMax).toBe(12_040_000)
    expect(cost?.currency).toBe('CNY')
  })

  it('omits the upper bound when the table has one band', () => {
    const singleBand: PricingTable = {
      currency: 'CNY',
      prices: [{ model: 'flash', input: 2, cacheRead: 0.04, cacheWrite: 2, output: 8 }],
    }
    const cost = priceBuckets(singleBand, { provider: 'any', model: 'flash' }, tokens({ outputTokens: 1_000_000 }))
    expect(cost?.amountMicros).toBe(8_000_000)
    expect(cost?.amountMicrosMax).toBeUndefined()
  })

  it('applies the bands to the fallback card too', () => {
    const withFallback: PricingTable = {
      currency: 'CNY',
      prices: [],
      fallback: {
        input: 2,
        cacheRead: 0.04,
        cacheWrite: 2,
        output: 8,
        offPeak: { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
      },
    }
    const cost = priceBuckets(withFallback, null, tokens({ uncachedInputTokens: 1_000_000 }))
    expect(cost?.amountMicros).toBe(1_000_000)
    expect(cost?.amountMicrosMax).toBe(2_000_000)
  })

  it('keeps both bounds equal as a single amount when a band is configured identically', () => {
    const same: PricingTable = {
      currency: 'CNY',
      prices: [{
        model: 'flat',
        input: 2,
        cacheRead: 2,
        cacheWrite: 2,
        output: 2,
        offPeak: { input: 2, cacheRead: 2, cacheWrite: 2, output: 2 },
      }],
    }
    const cost = priceBuckets(same, { provider: 'any', model: 'flat' }, tokens({ outputTokens: 10 }))
    expect(cost?.amountMicros).toBe(20)
    expect(cost?.amountMicrosMax).toBeUndefined()
  })
})

describe('mergeCosts with ranges', () => {
  /** Build a cost view for merge tests. */
  function view(amountMicros: number, amountMicrosMax?: number): CostView {
    return {
      amountMicros,
      ...(amountMicrosMax === undefined ? {} : { amountMicrosMax }),
      currency: 'CNY',
      pricedTokens: 10,
      totalTokens: 10,
      complete: true,
    }
  }

  it('sums both bounds when either side is a range', () => {
    const merged = mergeCosts(view(100, 200), view(50))
    expect(merged?.amountMicros).toBe(150)
    expect(merged?.amountMicrosMax).toBe(250)
  })

  it('keeps a single bound when neither side is a range', () => {
    const merged = mergeCosts(view(100), view(50))
    expect(merged?.amountMicros).toBe(150)
    expect(merged?.amountMicrosMax).toBeUndefined()
  })
})

describe('shipped DeepSeek price table', () => {
  it('prices the DeepSeek list rates for both models and bands', () => {
    // The official list (CNY per million tokens): flash 2 / 0.04 / 8 peak,
    // half off-peak; pro 9 / 0.30 / 27 peak, half off-peak.
    const flash = PRICING.prices.find(entry => entry.model === 'deepseek-flash')
    expect(flash).toMatchObject({
      input: 2, cacheRead: 0.04, cacheWrite: 2, output: 8,
      offPeak: { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
    })
    const pro = PRICING.prices.find(entry => entry.model === 'deepseek-v4-pro')
    expect(pro).toMatchObject({
      input: 9, cacheRead: 0.3, cacheWrite: 9, output: 27,
      offPeak: { input: 4.5, cacheRead: 0.15, cacheWrite: 4.5, output: 13.5 },
    })
  })

  it('prices one million cache-read tokens of deepseek-flash between 0.02 and 0.04 CNY', () => {
    const cost = priceBuckets(PRICING, { provider: 'deepseek', model: 'deepseek-flash' }, tokens({ cacheReadTokens: 1_000_000 }))
    expect(cost?.amountMicros).toBe(20_000)
    expect(cost?.amountMicrosMax).toBe(40_000)
  })
})
