import { describe, expect, it } from 'vitest'
import {
  currencySymbol,
  formatAmountFixed,
  formatBeijingTime,
  formatCount,
  formatDuration,
  formatMoney,
  formatMoneyFixed,
  formatMoneyRange,
  formatPercent,
  formatTokenCount,
  formatTokens,
  formatTokensPerSecond,
} from '../src/lib/format.ts'

describe('formatTokens', () => {
  it('keeps counts below one thousand verbatim', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(7)).toBe('7')
    expect(formatTokens(999)).toBe('999')
  })

  it('scales counts between one thousand and one million with a K suffix', () => {
    expect(formatTokens(1_000)).toBe('1K')
    expect(formatTokens(1_234)).toBe('1.2K')
    expect(formatTokens(9_949)).toBe('9.9K')
    expect(formatTokens(9_960)).toBe('10K')
    expect(formatTokens(12_345)).toBe('12K')
    expect(formatTokens(123_456)).toBe('123K')
  })

  it('promotes a rounding k value to the next unit', () => {
    expect(formatTokens(999_999)).toBe('1M')
    expect(formatTokens(1_000_000)).toBe('1M')
  })

  it('uses M and G suffixes above their thresholds', () => {
    expect(formatTokens(1_234_567)).toBe('1.2M')
    expect(formatTokens(12_345_678)).toBe('12M')
    expect(formatTokens(1_500_000_000)).toBe('1.5G')
  })

  it('keeps the sign of a negative value', () => {
    expect(formatTokens(-1_234)).toBe('-1.2K')
  })
})

describe('formatTokenCount', () => {
  it('keeps the exact value with thousands separators', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(154_487)).toBe('154,487')
    expect(formatTokenCount(275_123_456)).toBe('275,123,456')
  })

  it('rounds a fractional token count', () => {
    expect(formatTokenCount(1_234.6)).toBe('1,235')
  })
})

describe('formatCount', () => {
  it('groups digits with thousands separators', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1_234)).toBe('1,234')
    expect(formatCount(1_234_567)).toBe('1,234,567')
  })
})

describe('formatPercent', () => {
  it('rounds ordinary ratios to whole percent', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.5)).toBe('50%')
    expect(formatPercent(0.784)).toBe('78%')
    expect(formatPercent(0.999)).toBe('99.9%')
  })

  it('keeps one decimal just below a full bar', () => {
    expect(formatPercent(0.996)).toBe('99.6%')
    expect(formatPercent(0.9951)).toBe('99.5%')
  })

  it('clamps ratios outside the unit interval', () => {
    expect(formatPercent(1)).toBe('100%')
    expect(formatPercent(1.4)).toBe('100%')
    expect(formatPercent(-0.2)).toBe('0%')
  })
})

describe('formatDuration', () => {
  it('shows sub-second durations as one decimal of a second', () => {
    expect(formatDuration(0)).toBe('0.0s')
    expect(formatDuration(400)).toBe('0.4s')
    expect(formatDuration(999)).toBe('1.0s')
  })

  it('shows durations below a minute with one decimal', () => {
    expect(formatDuration(45_200)).toBe('45.2s')
    expect(formatDuration(59_000)).toBe('59.0s')
  })

  it('switches to minutes and seconds at one minute', () => {
    expect(formatDuration(60_000)).toBe('1m0s')
    expect(formatDuration(162_000)).toBe('2m42s')
  })

  it('switches to hours at one hour', () => {
    expect(formatDuration(3_600_000)).toBe('1h0m')
    expect(formatDuration(3_720_000)).toBe('1h2m')
  })

  it('clamps negative input to zero', () => {
    expect(formatDuration(-50)).toBe('0.0s')
  })
})

describe('formatTokensPerSecond', () => {
  it('shows one decimal below one hundred tokens per second', () => {
    expect(formatTokensPerSecond(42.3)).toBe('42.3 tok/s')
    expect(formatTokensPerSecond(9.5)).toBe('9.5 tok/s')
    expect(formatTokensPerSecond(99)).toBe('99 tok/s')
    expect(formatTokensPerSecond(0)).toBe('0 tok/s')
  })

  it('rounds three-digit speeds to whole tokens per second', () => {
    expect(formatTokensPerSecond(100)).toBe('100 tok/s')
    expect(formatTokensPerSecond(123.4)).toBe('123 tok/s')
  })

  it('clamps negative input to zero', () => {
    expect(formatTokensPerSecond(-5)).toBe('0 tok/s')
  })
})

describe('formatMoney', () => {
  it('formats a zero amount instead of leaving it blank', () => {
    expect(formatMoney(0, 'USD')).toBe('$0.00')
  })

  it('formats whole currency units with cents', () => {
    expect(formatMoney(1_000_000, 'USD')).toBe('$1.00')
    expect(formatMoney(2_500_000, 'USD')).toBe('$2.50')
    expect(formatMoney(1_234_567, 'USD')).toBe('$1.23')
    expect(formatMoney(1_234_567_890, 'USD')).toBe('$1,234.57')
  })

  it('keeps sub-cent amounts non-zero', () => {
    expect(formatMoney(12_345, 'USD')).toBe('$0.0123')
    expect(formatMoney(2_800, 'USD')).toBe('$0.0028')
    expect(formatMoney(123, 'USD')).toBe('$0.000123')
  })

  it('uses the currency symbol of the given code', () => {
    expect(formatMoney(1_000_000, 'EUR')).toBe('€1.00')
    expect(formatMoney(1_000_000, 'CNY')).toBe('¥1.00')
  })
})

describe('formatMoneyFixed', () => {
  it('pads every amount to the same fraction width', () => {
    expect(formatMoneyFixed(20_040_000, 'CNY', 3)).toBe('¥20.040')
    expect(formatMoneyFixed(1_200_000, 'CNY', 3)).toBe('¥1.200')
    expect(formatMoneyFixed(4_790, 'CNY', 3)).toBe('¥0.005')
    expect(formatMoneyFixed(0, 'CNY', 3)).toBe('¥0.000')
  })

  it('rounds to the requested width instead of keeping extra digits', () => {
    expect(formatMoneyFixed(12_345, 'USD', 3)).toBe('$0.012')
    expect(formatMoneyFixed(1_234_567, 'USD', 2)).toBe('$1.23')
  })
})

describe('formatAmountFixed', () => {
  it('keeps digits only, at a fixed fraction width', () => {
    expect(formatAmountFixed(20_441_546, 6)).toBe('20.441546')
    expect(formatAmountFixed(4_794, 6)).toBe('0.004794')
    expect(formatAmountFixed(0, 6)).toBe('0.000000')
  })
})

describe('currencySymbol', () => {
  it('returns the narrow symbol of the code', () => {
    expect(currencySymbol('CNY')).toBe('¥')
    expect(currencySymbol('USD')).toBe('$')
  })
})

describe('formatBeijingTime', () => {
  it('renders the request start in Beijing time', () => {
    // 02:05 UTC is 10:05 in Beijing.
    expect(formatBeijingTime(Date.UTC(2026, 9, 21, 2, 5))).toBe('10-21 10:05')
    // 17:30 UTC is 01:30 the next Beijing day.
    expect(formatBeijingTime(Date.UTC(2026, 9, 21, 17, 30))).toBe('10-22 01:30')
  })
})

describe('formatMoneyRange', () => {
  it('prints one amount when a single band applies', () => {
    expect(formatMoneyRange(1_000_000, undefined, 'CNY')).toBe('¥1.00')
    expect(formatMoneyRange(1_000_000, 1_000_000, 'CNY')).toBe('¥1.00')
  })

  it('prints both bounds when peak and off-peak differ', () => {
    expect(formatMoneyRange(1_000_000, 2_000_000, 'CNY')).toBe('¥1.00 – ¥2.00')
  })

  it('keeps sub-cent bounds readable', () => {
    expect(formatMoneyRange(2_345, 4_690, 'USD')).toBe('$0.00235 – $0.00469')
  })
})
