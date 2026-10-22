import { describe, expect, it } from 'vitest'
import type { BandModelView, UsageBandsView } from '../src/client/contract.ts'
import { bandShareOf, peakRequestShare, peakTokenShare } from '../src/lib/band-share.ts'
import { aggregateHistory } from '../src/lib/aggregate.ts'

/** One model's counters inside one band. */
function entry(requests: number, uncachedInputTokens: number, outputTokens = 0): BandModelView {
  return {
    provider: 'deepseek',
    model: 'deepseek-flash',
    requests,
    uncachedInputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens,
    reasoningTokens: 0,
  }
}

/** One rollup with the given band counters. */
function bands(peak: BandModelView[], offPeak: BandModelView[]): UsageBandsView {
  return { days: [], total: { peak, offPeak } }
}

describe('bandShareOf', () => {
  it('splits tokens and requests by band', () => {
    const share = bandShareOf(bands([entry(3, 300)], [entry(1, 100)]))
    expect(share).toEqual({ peakTokens: 300, offPeakTokens: 100, peakRequests: 3, offPeakRequests: 1 })
    expect(peakTokenShare(share)).toBe(0.75)
    expect(peakRequestShare(share)).toBe(0.75)
  })

  it('returns null without a rollup or with no requests', () => {
    expect(bandShareOf(undefined)).toBeNull()
    expect(bandShareOf(bands([], []))).toBeNull()
    expect(peakTokenShare(null)).toBeNull()
  })

  it('counts output tokens in the token share', () => {
    const share = bandShareOf(bands([entry(1, 0, 100)], [entry(1, 0, 300)]))
    expect(peakTokenShare(share)).toBe(0.25)
  })
})

describe('aggregateHistory band share', () => {
  it('accumulates the share across conversations with rollups', () => {
    const now = Date.UTC(2026, 9, 21, 12, 0)
    const view = aggregateHistory({
      sessions: [
        { id: 'a', updatedAt: now, model: null, bands: bands([entry(2, 200)], [entry(2, 200)]) },
        { id: 'b', updatedAt: now, model: null, bands: bands([entry(1, 100)], []) },
      ],
      range: '7d',
      now,
      pricing: { currency: 'CNY', prices: [] },
    })
    expect(view.agents.root.sessions).toBe(2)
    expect(peakTokenShare(view.bandShare)).toBeCloseTo(300 / 500)
    expect(peakRequestShare(view.bandShare)).toBeCloseTo(3 / 5)
    expect(view.bandSharePartial).toBe(false)
  })

  it('splits each day bar by band', () => {
    const now = Date.UTC(2026, 9, 21, 12, 0)
    const rollup: UsageBandsView = {
      days: [{ day: '2026-10-20', peak: [entry(2, 200)], offPeak: [entry(1, 100)] }],
      total: { peak: [entry(2, 200)], offPeak: [entry(1, 100)] },
    }
    const view = aggregateHistory({
      sessions: [{ id: 'a', updatedAt: now, model: null, bands: rollup }],
      range: '7d',
      now,
      pricing: { currency: 'CNY', prices: [] },
    })
    expect(view.days).toEqual([{
      day: '2026-10-20',
      totalTokens: 300,
      inputTokens: 300,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      sessions: 3,
      peakTokens: 200,
      offPeakTokens: 100,
      unattributedTokens: 0,
    }])
  })

  it('marks the share partial when a conversation has no rollup', () => {
    const now = Date.UTC(2026, 9, 21, 12, 0)
    const view = aggregateHistory({
      sessions: [
        { id: 'a', updatedAt: now, model: null, bands: bands([entry(1, 100)], []) },
        {
          id: 'b',
          updatedAt: now,
          model: null,
          tokenUsage: { uncachedInputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
        },
      ],
      range: '7d',
      now,
      pricing: { currency: 'CNY', prices: [] },
    })
    expect(view.bandSharePartial).toBe(true)
    expect(peakTokenShare(view.bandShare)).toBe(1)
  })
})
