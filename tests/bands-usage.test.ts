import { describe, expect, it } from 'vitest'
import type { BandModelView, PricingTable, UsageBandsView } from '../src/client/contract.ts'
import { aggregateHistory } from '../src/lib/aggregate.ts'
import { deriveSessionUsage } from '../src/lib/usage.ts'

/** DeepSeek flash rates: peak 2/0.04/8, off-peak half. */
const pricing: PricingTable = {
  currency: 'CNY',
  prices: [{
    model: 'deepseek-flash',
    input: 2,
    cacheRead: 0.04,
    cacheWrite: 2,
    output: 8,
    offPeak: { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
  }],
}

/** One model's counters inside one band. */
function entry(requests: number, uncachedInputTokens: number): BandModelView {
  return {
    provider: 'deepseek',
    model: 'deepseek-flash',
    requests,
    uncachedInputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  }
}

/** One day in both bands. */
const bands: UsageBandsView = {
  days: [
    { day: '2026-10-21', peak: [entry(1, 1_000_000)], offPeak: [entry(1, 1_000_000)] },
  ],
  total: { peak: [entry(1, 1_000_000)], offPeak: [entry(1, 1_000_000)] },
}

describe('deriveSessionUsage with Host projections', () => {
  it('prices the per-band rollup exactly and labels the basis', () => {
    const view = deriveSessionUsage({ bands, pricing })
    // One million peak input tokens at 2 CNY plus one million off-peak at 1 CNY.
    expect(view.cost?.amountMicros).toBe(3_000_000)
    expect(view.cost?.complete).toBe(true)
    expect(view.costBasis).toBe('bands')
    expect(view.requests).toBe(0)
    expect(view.bandShare).toEqual({
      peakTokens: 1_000_000,
      offPeakTokens: 1_000_000,
      peakRequests: 1,
      offPeakRequests: 1,
    })
  })

  it('reports the amount split of the same bands', () => {
    const view = deriveSessionUsage({ bands, pricing })
    // Same million tokens in each band, but peak input costs twice as much.
    expect(view.costBandShare).toEqual({ peakMicros: 2_000_000, offPeakMicros: 1_000_000 })
    expect(view.cost?.currency).toBe('CNY')
  })

  it('reports no amount split when only cumulative counters exist', () => {
    const view = deriveSessionUsage({
      tokenUsage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      modelSelection: { lastUsed: { provider: 'deepseek', model: 'deepseek-flash' }, next: null },
      pricing,
    })
    expect(view.costBandShare).toBeNull()
  })

  it('reports no amount split when part of the rollup is unpriced', () => {
    const unpricedEntry: BandModelView = { ...entry(1, 1_000_000), provider: 'other', model: 'unknown' }
    const view = deriveSessionUsage({
      bands: {
        days: [],
        total: { peak: [entry(1, 1_000_000)], offPeak: [unpricedEntry] },
      },
      pricing,
    })
    expect(view.cost?.complete).toBe(false)
    expect(view.costBandShare).toBeNull()
  })

  it('falls back to a range when the rollup is absent', () => {
    const view = deriveSessionUsage({
      tokenUsage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      modelSelection: { lastUsed: { provider: 'deepseek', model: 'deepseek-flash' }, next: null },
      pricing,
    })
    expect(view.cost?.amountMicros).toBe(1_000_000)
    expect(view.cost?.amountMicrosMax).toBe(2_000_000)
    expect(view.costBasis).toBe('range')
  })

  it('prices each step in its own band and exposes the window', () => {
    const view = deriveSessionUsage({
      steps: {
        steps: [
          {
            at: Date.UTC(2026, 9, 21, 2, 0), turn: 1, step: 0, provider: 'deepseek', model: 'deepseek-flash',
            band: 'peak', uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0,
            outputTokens: 0, reasoningTokens: 0,
          },
          {
            at: Date.UTC(2026, 9, 21, 12, 0), turn: 2, step: 0, provider: 'deepseek', model: 'deepseek-flash',
            band: 'off-peak', uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0,
            outputTokens: 0, reasoningTokens: 0,
          },
        ],
        totalSteps: 7,
        omittedSteps: 5,
      },
      pricing,
    })
    expect(view.stepActivity?.totalSteps).toBe(7)
    expect(view.stepActivity?.omittedSteps).toBe(5)
    expect(view.stepActivity?.steps.map(step => step.cost?.amountMicros)).toEqual([2_000_000, 1_000_000])
    expect(view.requests).toBe(7)
  })
})

describe('aggregateHistory with band rollups', () => {
  it('takes days and cost from the rollup and reports the exact basis', () => {
    const now = Date.UTC(2026, 9, 21, 12, 0)
    const view = aggregateHistory({
      sessions: [{ id: 'a', updatedAt: now, model: null, bands }],
      range: '7d',
      now,
      pricing,
    })
    expect(view.costBasis).toBe('bands')
    expect(view.totalTokens).toBe(2_000_000)
    expect(view.days).toHaveLength(1)
    expect(view.days[0]).toMatchObject({ day: '2026-10-21', totalTokens: 2_000_000, sessions: 2 })
    expect(view.cost?.amountMicros).toBe(3_000_000)
    expect(view.cost?.amountMicrosMax).toBeUndefined()
  })
})
