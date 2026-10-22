import { describe, expect, it } from 'vitest'
import { FULL_HIT_RATIO, HIT_SCALE_EXPONENT, HIT_TICKS, hitBarRatio, hitLevel } from '../src/lib/hit-scale.ts'

describe('HIT_TICKS', () => {
  it('marks ascending reference points inside the range', () => {
    expect([...HIT_TICKS]).toEqual([0.5, 0.7, 0.85, 0.95, 0.99, 0.999])
    expect([...HIT_TICKS].every(tick => tick > 0 && tick < 1)).toBe(true)
    expect([...HIT_TICKS].every((tick, index, ticks) => index === 0 || ticks[index - 1]! < tick)).toBe(true)
  })

  it('shows the non-linear spacing through denser marks near the top', () => {
    const positions = HIT_TICKS.map(tick => hitBarRatio(tick))
    const gaps = positions.slice(1).map((position, index) => position - positions[index]!)
    // Unequal gaps: the track cannot be read as a linear percentage axis.
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeGreaterThan(1.2)
    // Every mark sits left of where a linear axis would put it.
    for (const tick of HIT_TICKS) expect(hitBarRatio(tick)).toBeLessThan(tick)
  })
})

describe('hitBarRatio', () => {
  it('keeps both endpoints', () => {
    expect(hitBarRatio(0)).toBe(0)
    expect(hitBarRatio(1)).toBe(1)
  })

  it('clamps values outside the ratio range', () => {
    expect(hitBarRatio(-1)).toBe(0)
    expect(hitBarRatio(2)).toBe(1)
  })

  it('fills the bar only when the label reads a full 100%', () => {
    expect(hitBarRatio(FULL_HIT_RATIO)).toBe(1)
    expect(hitBarRatio(1)).toBe(1)
    // Three decimals keep 99.9999% distinct from 100%, so the fill stops short.
    expect(hitBarRatio(0.9999)).toBeLessThan(1)
    expect(hitBarRatio(0.999)).toBeLessThan(1)
  })

  it('spreads the high end of the range', () => {
    expect(hitBarRatio(0.9)).toBeCloseTo(1 - 0.1 ** HIT_SCALE_EXPONENT, 6)
    expect(hitBarRatio(0.99)).toBeCloseTo(1 - 0.01 ** HIT_SCALE_EXPONENT, 6)
    // 99% and 99.9% stay visibly apart instead of collapsing at the bar's end.
    expect(hitBarRatio(0.999) - hitBarRatio(0.99)).toBeGreaterThan(0.1)
  })

  it('stays monotonic across the range', () => {
    expect(hitBarRatio(0.5)).toBeLessThan(hitBarRatio(0.7))
    expect(hitBarRatio(0.7)).toBeLessThan(hitBarRatio(0.9))
    expect(hitBarRatio(0.9)).toBeLessThan(hitBarRatio(0.99))
  })
})

describe('hitLevel', () => {
  it('classifies one rate into its status band', () => {
    expect(hitLevel(0.99)).toBe('good')
    expect(hitLevel(0.9)).toBe('good')
    expect(hitLevel(0.89)).toBe('warn')
    expect(hitLevel(0.7)).toBe('warn')
    expect(hitLevel(0.69)).toBe('bad')
    expect(hitLevel(0.4)).toBe('bad')
    expect(hitLevel(null)).toBe('none')
  })
})
