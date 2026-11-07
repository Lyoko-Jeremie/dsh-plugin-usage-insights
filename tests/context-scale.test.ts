import { describe, expect, it } from 'vitest'
import { CONTEXT_SCALE_KNEE, contextBarRatio, contextRatioAtHeight } from '../src/lib/context-scale'

describe('contextBarRatio', () => {
  it('anchors both ends of the scale', () => {
    expect(contextBarRatio(0)).toBe(0)
    expect(contextBarRatio(1)).toBe(1)
  })

  it('puts 50% occupancy at about three quarters of the plot', () => {
    expect(contextBarRatio(0.5)).toBeCloseTo(Math.log10(1 + CONTEXT_SCALE_KNEE * 0.5), 12)
    expect(contextBarRatio(0.5)).toBeGreaterThan(0.7)
    expect(contextBarRatio(0.5)).toBeLessThan(0.8)
  })

  it('spreads the low end more than the high end', () => {
    const low = contextBarRatio(0.25) - contextBarRatio(0)
    const high = contextBarRatio(1) - contextBarRatio(0.75)
    expect(low).toBeGreaterThan(high * 3)
  })

  it('clamps values outside the occupancy range', () => {
    expect(contextBarRatio(-0.4)).toBe(0)
    expect(contextBarRatio(2)).toBe(1)
  })
})

describe('contextRatioAtHeight', () => {
  it('inverts the scale', () => {
    for (const ratio of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
      expect(contextRatioAtHeight(contextBarRatio(ratio))).toBeCloseTo(ratio, 10)
    }
  })

  it('clamps heights outside the plot', () => {
    expect(contextRatioAtHeight(-1)).toBe(0)
    expect(contextRatioAtHeight(2)).toBe(1)
  })
})
