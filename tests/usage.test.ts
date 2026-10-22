import { describe, expect, it } from 'vitest'
import type { BreakdownView, PricingTable } from '../src/client/contract.ts'
import { deriveSessionUsage } from '../src/lib/usage.ts'

const pricing: PricingTable = {
  currency: 'USD',
  prices: [{ provider: 'deepseek', model: 'chat', input: 1, cacheRead: 0.5, cacheWrite: 2, output: 3 }],
}

const pricingWithFallback: PricingTable = {
  ...pricing,
  prices: [],
  fallback: { input: 1, cacheRead: 1, cacheWrite: 1, output: 1 },
}

const breakdown: BreakdownView = { systemTokens: 100, toolsTokens: 200, messageTokens: 300 }

describe('deriveSessionUsage', () => {
  it('derives the full view from complete projections', () => {
    const view = deriveSessionUsage({
      tokenUsage: {
        uncachedInputTokens: 1_000,
        cacheReadTokens: 2_000,
        cacheWriteTokens: 500,
        outputTokens: 250,
      },
      contextPressure: { pressureTokens: 80_000, projectedTokens: 90_000, contextWindow: 200_000 },
      contextBreakdown: breakdown,
      sessionStats: {
        turns: 2,
        steps: 3,
        llmMs: 8_000,
        toolMs: 4_000,
        ttftMs: 300,
        ttftSteps: 2,
        decodeMs: 1_000,
        decodeTokens: 800,
      },
      modelSelection: {
        lastUsed: { provider: 'old', model: 'legacy' },
        next: { provider: 'deepseek', model: 'chat' },
      },
      pricing,
    })

    expect(view.buckets).toEqual({
      uncachedInputTokens: 1_000,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 500,
      outputTokens: 250,
    })
    expect(view.totalTokens).toBe(3_750)
    expect(view.billedInputTokens).toBe(3_500)
    expect(view.cacheRate).toBeCloseTo(2_000 / 3_500, 6)
    expect(view.requests).toBe(3)
    expect(view.turns).toBe(2)
    expect(view.steps).toBe(3)
    expect(view.llmMs).toBe(8_000)
    expect(view.toolMs).toBe(4_000)
    expect(view.ttftAvgMs).toBe(150)
    expect(view.decodeTps).toBe(800)
    expect(view.context).toEqual({
      usedTokens: 90_000,
      windowTokens: 200_000,
      ratio: 0.45,
      source: 'projected',
    })
    expect(view.breakdown).toBe(breakdown)
    expect(view.model).toEqual({ provider: 'deepseek', model: 'chat' })
    expect(view.hasUsage).toBe(true)
    expect(view.cost).toEqual({
      amountMicros: 3_750,
      currency: 'USD',
      pricedTokens: 3_750,
      totalTokens: 3_750,
      complete: true,
    })
  })

  it('returns an empty view when no projection is available', () => {
    const view = deriveSessionUsage({ pricing })
    expect(view).toEqual({
      buckets: {
        uncachedInputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
      },
      totalTokens: 0,
      billedInputTokens: 0,
      cacheRate: null,
      cacheHits: { total: null, turn: null, step: null },
      requests: 0,
      turns: 0,
      steps: 0,
      llmMs: 0,
      toolMs: 0,
      ttftAvgMs: null,
      decodeTps: null,
      context: { usedTokens: null, windowTokens: null, ratio: null, source: null },
      breakdown: null,
      model: null,
      cost: null,
      costBasis: 'range',
      stepActivity: null,
      bandShare: null,
      hasUsage: false,
    })
  })

  it('prices empty buckets when the table has a fallback', () => {
    const view = deriveSessionUsage({ pricing: pricingWithFallback })
    expect(view.cost).toEqual({
      amountMicros: 0,
      currency: 'USD',
      pricedTokens: 0,
      totalTokens: 0,
      complete: true,
    })
    expect(view.hasUsage).toBe(false)
  })

  it('reports pressure tokens when no projection is available', () => {
    const view = deriveSessionUsage({
      contextPressure: { pressureTokens: 50_000, contextWindow: 100_000 },
      pricing,
    })
    expect(view.context).toEqual({
      usedTokens: 50_000,
      windowTokens: 100_000,
      ratio: 0.5,
      source: 'pressure',
    })
  })

  it('prefers a projected size of zero over the pressure figure', () => {
    const view = deriveSessionUsage({
      contextPressure: { projectedTokens: 0, pressureTokens: 90_000, contextWindow: 100_000 },
      pricing,
    })
    expect(view.context).toEqual({
      usedTokens: 0,
      windowTokens: 100_000,
      ratio: 0,
      source: 'projected',
    })
  })

  it('clamps context occupancy to a full window', () => {
    const view = deriveSessionUsage({
      contextPressure: { projectedTokens: 150_000, contextWindow: 100_000 },
      pricing,
    })
    expect(view.context.ratio).toBe(1)
  })

  it('leaves the context ratio null without a declared window', () => {
    const view = deriveSessionUsage({
      contextPressure: { pressureTokens: 100 },
      pricing,
    })
    expect(view.context).toEqual({ usedTokens: 100, windowTokens: null, ratio: null, source: 'pressure' })
  })

  it('falls back to the last used model when none is planned', () => {
    const view = deriveSessionUsage({
      tokenUsage: {
        uncachedInputTokens: 1_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
      },
      modelSelection: { lastUsed: { provider: 'deepseek', model: 'chat' }, next: null },
      pricing,
    })
    expect(view.model).toEqual({ provider: 'deepseek', model: 'chat' })
    expect(view.cost?.amountMicros).toBe(1_000)
  })

  it('leaves latency figures null without recorded samples', () => {
    const view = deriveSessionUsage({
      sessionStats: {
        turns: 0,
        steps: 0,
        llmMs: 0,
        toolMs: 0,
        ttftMs: 500,
        ttftSteps: 0,
        decodeMs: 0,
        decodeTokens: 400,
      },
      pricing,
    })
    expect(view.ttftAvgMs).toBeNull()
    expect(view.decodeTps).toBeNull()
  })

  it('copies the usage buckets instead of aliasing the projection', () => {
    const tokenUsage = {
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    }
    const view = deriveSessionUsage({ tokenUsage, pricing })
    expect(view.buckets).not.toBe(tokenUsage)
    expect(view.buckets).toEqual(tokenUsage)
    expect(view.hasUsage).toBe(false)
    expect(view.cacheRate).toBeNull()
  })
})

describe('cacheHits', () => {
  /** One request row with its input-side counters. */
  function step(turn: number, index: number, uncached: number, read: number) {
    return {
      at: index,
      turn,
      step: index,
      provider: 'deepseek',
      model: 'chat',
      band: 'peak' as const,
      uncachedInputTokens: uncached,
      cacheReadTokens: read,
      cacheWriteTokens: 0,
      outputTokens: 10,
      reasoningTokens: 0,
    }
  }

  it('reports whole-log, newest-turn and newest-request hit rates', () => {
    const view = deriveSessionUsage({
      tokenUsage: { uncachedInputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 50 },
      steps: {
        steps: [
          step(1, 1, 100, 0),
          step(1, 2, 0, 100),
          step(2, 1, 25, 75),
          step(2, 2, 50, 50),
        ],
        totalSteps: 4,
        omittedSteps: 0,
      },
      pricing,
    })
    expect(view.cacheHits.total).toBeCloseTo(0.9, 6)
    expect(view.cacheHits.turn).toBeCloseTo(125 / 200, 6)
    expect(view.cacheHits.step).toBeCloseTo(0.5, 6)
  })

  it('leaves the turn and step rates null without a request window', () => {
    const view = deriveSessionUsage({
      tokenUsage: { uncachedInputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
      pricing,
    })
    expect(view.cacheHits).toEqual({ total: 0, turn: null, step: null })
  })
})
