import { describe, expect, it } from 'vitest'
import {
  FULL_HIT_RATIO, HIT_MIN_DIVISIONS, HIT_MIN_SEGMENT_PX, HIT_SCALE_EXPONENT,
  divisionsForWidth, hitBarRatio, hitLevel, hitRatioAtWidth, hitTickLabel, hitTicks,
} from '../src/lib/hit-scale.ts'

describe('divisionsForWidth', () => {
  it('never goes below two segments', () => {
    expect(HIT_MIN_DIVISIONS).toBe(2)
    expect(divisionsForWidth(0)).toBe(2)
    expect(divisionsForWidth(1)).toBe(2)
    expect(divisionsForWidth(2 * HIT_MIN_SEGMENT_PX - 1)).toBe(2)
  })

  it('keeps every segment at least the minimum width', () => {
    for (const width of [50, 96, 191, 192, 383, 384, 767, 768, 1536, 3000]) {
      const divisions = divisionsForWidth(width)
      expect(Number.isInteger(Math.log2(divisions))).toBe(true)
      if (width >= 2 * HIT_MIN_SEGMENT_PX) {
        expect(width / divisions).toBeGreaterThanOrEqual(HIT_MIN_SEGMENT_PX)
      }
    }
  })

  it('halves the segments each time the track gains that much width again', () => {
    expect(divisionsForWidth(384)).toBe(8)
    expect(divisionsForWidth(768)).toBe(16)
    expect(divisionsForWidth(1536)).toBe(32)
  })

  it('has no upper bound', () => {
    const huge = 10_000_000
    const divisions = divisionsForWidth(huge)
    expect(divisions).toBeGreaterThan(100_000)
    expect(huge / divisions).toBeGreaterThanOrEqual(HIT_MIN_SEGMENT_PX)
  })
})

describe('hitTicks', () => {
  it('divides the track into equal lengths ending at both edges', () => {
    for (const divisions of [2, 4, 8, 16]) {
      const ticks = hitTicks(divisions)
      expect(ticks).toHaveLength(divisions + 1)
      expect(ticks[0]).toEqual({ width: 0, ratio: 0 })
      expect(ticks[ticks.length - 1]).toEqual({ width: 1, ratio: 1 })
      const gaps = ticks.slice(1).map((tick, index) => tick.width - ticks[index]!.width)
      expect(new Set(gaps.map(gap => gap.toFixed(10))).size).toBe(1)
    }
  })

  it('labels each division with the rate that fills it', () => {
    expect(hitTicks(8).map(tick => hitTickLabel(tick.ratio))).toEqual([
      '0%', '35.9%', '61.7%', '79.1%', '90.1%', '96.2%', '99.0%', '99.90%', '100%',
    ])
  })

  it('shows the non-linear spacing through the labels, not through the marks', () => {
    const ticks = hitTicks(8)
    // Half the track is a 90% hit rate: the axis cannot be read linearly.
    expect(ticks[4]!.width).toBe(0.5)
    expect(ticks[4]!.ratio).toBeCloseTo(1 - 0.5 ** (1 / HIT_SCALE_EXPONENT), 10)
  })
})

describe('hitTickLabel', () => {
  it('keeps the last marks before 100% distinct', () => {
    expect(hitTickLabel(hitRatioAtWidth(7 / 8))).toBe('99.90%')
    expect(hitTickLabel(hitRatioAtWidth(15 / 16))).toBe('99.99%')
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
