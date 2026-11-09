import { describe, expect, it } from 'vitest'
import type { PricingTable, TokenBuckets, UsageBandsView, UsageStepView } from '../src/client/contract.ts'
import { deriveCacheAmount } from '../src/lib/cache-amount.ts'

const route = { provider: 'deepseek', model: 'chat' }

const pricing: PricingTable = {
  currency: 'USD',
  prices: [{
    ...route,
    input: 1,
    cacheRead: 0.5,
    cacheWrite: 2,
    output: 3,
    offPeak: { input: 1, cacheRead: 0.25, cacheWrite: 2, output: 3 },
  }],
}

/** Cumulative buckets used by the composition tests. */
const buckets: TokenBuckets = {
  uncachedInputTokens: 1_000,
  cacheReadTokens: 2_000,
  cacheWriteTokens: 500,
  outputTokens: 250,
}

/** One request row. */
function step(
  turn: number,
  index: number,
  uncached: number,
  read: number,
  band: 'peak' | 'off-peak' = 'peak',
): UsageStepView {
  return {
    at: index,
    turn,
    step: index,
    provider: 'deepseek',
    model: 'chat',
    band,
    uncachedInputTokens: uncached,
    cacheReadTokens: read,
    cacheWriteTokens: 0,
    outputTokens: 10,
    reasoningTokens: 0,
  }
}

describe('deriveCacheAmount', () => {
  it('splits cumulative buckets by purpose and reports the band range', () => {
    const view = deriveCacheAmount(pricing, null, null, route, buckets)
    expect(view.total).toEqual({
      slices: [
        { key: 'cacheRead', micros: 500, microsMax: 1_000, tokens: 2_000 },
        { key: 'uncachedInput', micros: 1_000, tokens: 1_000 },
        { key: 'cacheWrite', micros: 1_000, tokens: 500 },
        { key: 'output', micros: 750, tokens: 250 },
      ],
      micros: 3_250,
      microsMax: 3_750,
      currency: 'USD',
      complete: true,
      unpricedTokens: 0,
    })
    expect(view.turn).toBeNull()
    expect(view.step).toBeNull()
  })

  it('prices every per-band entry in the band it ran in', () => {
    const bands: UsageBandsView = {
      days: [],
      total: {
        peak: [{
          provider: 'deepseek', model: 'chat', requests: 1,
          uncachedInputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0,
          outputTokens: 50, reasoningTokens: 0,
        }],
        offPeak: [{
          provider: 'deepseek', model: 'chat', requests: 1,
          uncachedInputTokens: 200, cacheReadTokens: 800, cacheWriteTokens: 100,
          outputTokens: 100, reasoningTokens: 0,
        }],
      },
    }
    const view = deriveCacheAmount(pricing, bands, null, route, buckets)
    expect(view.total).toEqual({
      slices: [
        { key: 'cacheRead', micros: 650, tokens: 1_700 },
        { key: 'uncachedInput', micros: 300, tokens: 300 },
        { key: 'cacheWrite', micros: 200, tokens: 100 },
        { key: 'output', micros: 450, tokens: 150 },
      ],
      micros: 1_600,
      currency: 'USD',
      complete: true,
      unpricedTokens: 0,
    })
  })

  it('prices the newest turn and the newest request from the window', () => {
    const steps = [step(1, 1, 100, 0), step(2, 1, 0, 100), step(2, 2, 50, 50)]
    const view = deriveCacheAmount(pricing, null, steps, route, buckets)
    // Turn 2: 50 uncached + 150 cache read + 20 output.
    expect(view.turn?.micros).toBe(75 + 50 + 60)
    expect(view.turn?.slices.find(slice => slice.key === 'cacheRead')?.tokens).toBe(150)
    // Newest request: 50 uncached + 50 cache read + 10 output.
    expect(view.step?.micros).toBe(25 + 50 + 30)
  })

  it('returns null scopes when no price applies to the route', () => {
    const unpriced: PricingTable = { currency: 'USD', prices: [] }
    const steps = [step(1, 1, 10, 0)]
    const view = deriveCacheAmount(unpriced, null, steps, route, buckets)
    expect(view).toEqual({ total: null, turn: null, step: null })
  })

  it('keeps priced parts and counts the unpriced ones', () => {
    const bands: UsageBandsView = {
      days: [],
      total: {
        peak: [
          {
            provider: 'deepseek', model: 'chat', requests: 1,
            uncachedInputTokens: 100, cacheReadTokens: 100, cacheWriteTokens: 0,
            outputTokens: 10, reasoningTokens: 0,
          },
          {
            provider: 'unknown', model: 'other', requests: 1,
            uncachedInputTokens: 60, cacheReadTokens: 40, cacheWriteTokens: 0,
            outputTokens: 0, reasoningTokens: 0,
          },
        ],
        offPeak: [],
      },
    }
    const view = deriveCacheAmount(pricing, bands, null, route, buckets)
    expect(view.total?.complete).toBe(false)
    expect(view.total?.unpricedTokens).toBe(100)
    expect(view.total?.micros).toBe(50 + 100 + 30)
  })

  it('leaves the cumulative scope null when nothing was billed', () => {
    const empty: TokenBuckets = {
      uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
    }
    const view = deriveCacheAmount(pricing, null, [], route, empty)
    expect(view).toEqual({ total: null, turn: null, step: null })
  })
})
