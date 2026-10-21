import { describe, expect, it } from 'vitest'
import { bandAt, beijingDay } from '../src/shared/band.js'

/** UTC instant of one Beijing wall-clock time. */
function beijing(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour - 8, minute)
}

describe('beijingDay', () => {
  it('rolls the day over at Beijing midnight, not UTC midnight', () => {
    expect(beijingDay(beijing(2026, 10, 21, 23, 59))).toBe('2026-10-21')
    expect(beijingDay(beijing(2026, 10, 22, 0, 1))).toBe('2026-10-22')
    // 17:00 UTC is already the next Beijing day.
    expect(beijingDay(Date.UTC(2026, 9, 21, 17, 0))).toBe('2026-10-22')
  })
})

describe('bandAt', () => {
  it('bills weekday work hours as peak', () => {
    // 2026-10-21 is a Wednesday.
    expect(bandAt(beijing(2026, 10, 21, 9, 0))).toBe('peak')
    expect(bandAt(beijing(2026, 10, 21, 11, 59))).toBe('peak')
    expect(bandAt(beijing(2026, 10, 21, 14, 0))).toBe('peak')
    expect(bandAt(beijing(2026, 10, 21, 17, 59))).toBe('peak')
  })

  it('bills the gaps and both boundary hours as off-peak', () => {
    expect(bandAt(beijing(2026, 10, 21, 8, 59))).toBe('off-peak')
    expect(bandAt(beijing(2026, 10, 21, 12, 0))).toBe('off-peak')
    expect(bandAt(beijing(2026, 10, 21, 13, 59))).toBe('off-peak')
    expect(bandAt(beijing(2026, 10, 21, 18, 0))).toBe('off-peak')
    expect(bandAt(beijing(2026, 10, 21, 22, 0))).toBe('off-peak')
  })

  it('bills whole weekends off-peak', () => {
    // 2026-10-24 is a Saturday, 2026-10-25 a Sunday.
    expect(bandAt(beijing(2026, 10, 24, 10, 0))).toBe('off-peak')
    expect(bandAt(beijing(2026, 10, 25, 15, 0))).toBe('off-peak')
  })

  it('bills configured holidays off-peak even on a weekday morning', () => {
    expect(bandAt(beijing(2026, 10, 21, 10, 0), ['2026-10-21'])).toBe('off-peak')
    expect(bandAt(beijing(2026, 10, 21, 10, 0), ['2026-10-22'])).toBe('peak')
  })
})
