import { describe, expect, it } from 'vitest'
import type { StepDetailView } from '../src/client/contract.ts'
import { stepTrendPoints, hitSegmentParts } from '../src/lib/trend.ts'

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

  it('reads the priced amount and its currency', () => {
    const points = stepTrendPoints([
      step({ cost: { amountMicros: 1_250, currency: 'CNY', pricedTokens: 100, totalTokens: 100, complete: true } }),
    ], 1_000)
    expect(points[0]?.amountMicros).toBe(1_250)
    expect(points[0]?.amountCurrency).toBe('CNY')
  })

  it('keeps the amount unknown without a price', () => {
    const points = stepTrendPoints([step()], 1_000)
    expect(points[0]?.amountMicros).toBeNull()
    expect(points[0]?.amountCurrency).toBeNull()
  })

  it('clamps a negative amount and rejects a non-finite one', () => {
    const negative = stepTrendPoints([
      step({ cost: { amountMicros: -5, currency: 'CNY', pricedTokens: 100, totalTokens: 100, complete: true } }),
    ], 1_000)
    expect(negative[0]?.amountMicros).toBe(0)
    const infinite = stepTrendPoints([
      step({
        cost: {
          amountMicros: Number.POSITIVE_INFINITY,
          currency: 'CNY',
          pricedTokens: 100,
          totalTokens: 100,
          complete: true,
        },
      }),
    ], 1_000)
    expect(infinite[0]?.amountMicros).toBeNull()
    expect(infinite[0]?.amountCurrency).toBeNull()
  })
})

describe('hitSegmentParts', () => {
  it('splits a green-to-red segment at both level edges', () => {
    const parts = hitSegmentParts(0.95, 0.65)
    expect(parts.map(part => part.level)).toEqual(['good', 'warn', 'bad'])
    expect(parts[0]?.from).toBe(0)
    expect(parts.at(-1)?.to).toBe(1)
    for (let index = 1; index < parts.length; index += 1) {
      expect(parts[index]?.from).toBeCloseTo(parts[index - 1]?.to ?? -1, 9)
    }
  })

  it('splits only at the warn edge when green meets yellow', () => {
    expect(hitSegmentParts(0.95, 0.85).map(part => part.level)).toEqual(['good', 'warn'])
  })

  it('splits only at the warn edge when yellow meets red', () => {
    expect(hitSegmentParts(0.85, 0.6).map(part => part.level)).toEqual(['warn', 'bad'])
  })

  it('keeps a segment inside one level single', () => {
    expect(hitSegmentParts(0.65, 0.55).map(part => part.level)).toEqual(['bad'])
    expect(hitSegmentParts(0.95, 0.95)).toEqual([{ from: 0, to: 1, level: 'good' }])
  })

  it('orders the slices along the segment in either direction', () => {
    expect(hitSegmentParts(0.6, 0.95).map(part => part.level)).toEqual(['bad', 'warn', 'good'])
  })

  it('drops zero-length slices when an endpoint sits on an edge', () => {
    const parts = hitSegmentParts(0.9, 0.7)
    expect(parts).toHaveLength(1)
    expect(parts[0]?.level).toBe('warn')
  })
})
