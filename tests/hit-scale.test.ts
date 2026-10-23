import { describe, expect, it } from 'vitest'
import {
  FULL_HIT_RATIO, HIT_SCALE_EXPONENT, HIT_TICKS, HIT_TICK_DIVISIONS,
  hitBarRatio, hitLevel, hitRatioAtWidth, hitTickLabel,
} from '../src/lib/hit-scale.ts'
import type { HitTick } from '../src/lib/hit-scale.ts'

const visible = (maxTier: number): HitTick[] => HIT_TICKS.filter(tick => tick.tier <= maxTier)

describe('HIT_TICKS', () => {
  it('divides the track into equal lengths', () => {
    expect(HIT_TICKS).toHaveLength(HIT_TICK_DIVISIONS + 1)
    expect(HIT_TICKS.map(tick => tick.width)).toEqual(
      Array.from({ length: HIT_TICK_DIVISIONS + 1 }, (_, index) => index / HIT_TICK_DIVISIONS),
    )
  })

  it('labels each division with the rate that fills it', () => {
    for (const tick of HIT_TICKS) expect(hitBarRatio(tick.ratio)).toBeCloseTo(tick.width, 10)
    expect(HIT_TICKS[0]!.ratio).toBe(0)
    expect(HIT_TICKS[HIT_TICKS.length - 1]!.ratio).toBe(1)
    expect(HIT_TICKS.map(tick => tick.ratio)).toEqual(
      [...HIT_TICKS].map(tick => tick.ratio).sort((left, right) => left - right),
    )
  })

  it('shows the non-linear spacing through the labels, not through the marks', () => {
    const middle = HIT_TICKS[Math.floor(HIT_TICKS.length / 2)]!
    // Half the track is a 90% hit rate: the axis cannot be read linearly.
    expect(middle.width).toBeCloseTo(0.5, 10)
    expect(middle.ratio).toBeCloseTo(1 - 0.5 ** (1 / HIT_SCALE_EXPONENT), 10)
  })
})

describe('HIT_TICK tiers', () => {
  it('coarsens the same division grid as rows get narrower', () => {
    expect(visible(1).map(tick => tick.width)).toEqual([0, 1])
    expect(visible(2).map(tick => tick.width)).toEqual([0, 1 / 3, 2 / 3, 1])
    expect(visible(3)).toHaveLength(7)
    expect(visible(4)).toHaveLength(HIT_TICK_DIVISIONS + 1)
  })

  it('keeps every tier evenly spaced', () => {
    for (const maxTier of [1, 2, 3, 4]) {
      const widths = visible(maxTier).map(tick => tick.width)
      const gaps = widths.slice(1).map((width, index) => width - widths[index]!)
      expect(new Set(gaps.map(gap => gap.toFixed(10))).size).toBe(1)
    }
  })
})

describe('hitTickLabel', () => {
  it('prints the rate of each division', () => {
    expect(HIT_TICKS.map(tick => hitTickLabel(tick.ratio))).toEqual([
      '0%', '25.2%', '45.5%', '61.7%', '74.1%', '83.4%', '90.1%',
      '94.6%', '97.4%', '99.0%', '99.75%', '99.97%', '100%',
    ])
  })

  it('keeps the last marks before 100% distinct', () => {
    expect(hitTickLabel(hitRatioAtWidth(10 / 12))).toBe('99.75%')
    expect(hitTickLabel(hitRatioAtWidth(11 / 12))).toBe('99.97%')
    expect(hitTickLabel(1)).toBe('100%')
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

describe('hitRatioAtWidth', () => {
  it('inverts the bar scale', () => {
    for (const width of [0, 0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(hitBarRatio(hitRatioAtWidth(width))).toBeCloseTo(width, 6)
    }
    // Above the full-fill cutoff the forward scale snaps to a full bar.
    expect(hitBarRatio(hitRatioAtWidth(0.99))).toBe(1)
  })

  it('clamps values outside the width range', () => {
    expect(hitRatioAtWidth(-1)).toBe(0)
    expect(hitRatioAtWidth(2)).toBe(1)
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
