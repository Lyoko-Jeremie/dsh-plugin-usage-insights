import { describe, expect, it } from 'vitest'
import type { StepDetailView } from '../src/client/contract.ts'
import { stepTrendPoints } from '../src/lib/trend.ts'

/** One request row with overridable figures. */
function step(patch: Partial<StepDetailView> = {}): StepDetailView {
  return {
    at: 1_000,
    turn: 1,
    step: 0,
    provider: 'deepseek',
    model: 'deepseek-flash',
    band: 'peak',
    uncachedInputTokens: 10,
    cacheReadTokens: 90,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cost: null,
    agentIndex: null,
    ...patch,
  }
}

describe('stepTrendPoints', () => {
  it('orders requests oldest first', () => {
    const points = stepTrendPoints([
      step({ at: 300 }),
      step({ at: 100 }),
      step({ at: 200 }),
    ], 1_000)
    expect(points.map(point => point.at)).toEqual([100, 200, 300])
  })

  it('sums the billed prompt and derives both ratios', () => {
    const points = stepTrendPoints([
      step({ uncachedInputTokens: 10, cacheReadTokens: 90, cacheWriteTokens: 0 }),
    ], 1_000)
    expect(points[0]).toMatchObject({
      promptTokens: 100,
      contextRatio: 0.1,
      cacheRatio: 0.9,
      agentIndex: null,
    })
  })

  it('leaves occupancy unknown without a declared capacity', () => {
    const points = stepTrendPoints([step()], null)
    expect(points[0]?.contextRatio).toBeNull()
    expect(points[0]?.cacheRatio).toBe(0.9)
  })

  it('accepts a non-positive capacity as unknown', () => {
    expect(stepTrendPoints([step()], 0)[0]?.contextRatio).toBeNull()
  })

  it('keeps both ratios null when a request billed no input', () => {
    const points = stepTrendPoints([
      step({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
    ], 1_000)
    expect(points[0]?.promptTokens).toBe(0)
    expect(points[0]?.contextRatio).toBeNull()
    expect(points[0]?.cacheRatio).toBeNull()
  })

  it('clamps occupancy at a full window', () => {
    const points = stepTrendPoints([
      step({ uncachedInputTokens: 2_000, cacheReadTokens: 0 }),
    ], 1_000)
    expect(points[0]?.contextRatio).toBe(1)
  })

  it('keeps the agent number of every row', () => {
    const points = stepTrendPoints([step({ agentIndex: 2 })], 1_000)
    expect(points[0]?.agentIndex).toBe(2)
  })
})
