import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BUILTIN_HOLIDAY_RANGES,
  expandRange,
  fetchRemoteHolidays,
  parseHolidayDocument,
  resolveHolidays,
  syncYears,
  unionDays,
} from '../src/host/holidays.js'

/** Beijing wall-clock instant as epoch milliseconds. */
function beijing(year, month, day, hour = 12) {
  return Date.UTC(year, month - 1, day, hour - 8)
}

/** One `holiday-cn` document. */
function document(year, days) {
  return { year, days }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('expandRange', () => {
  it('expands one day', () => {
    expect(expandRange('2026-10-01')).toEqual(['2026-10-01'])
  })

  it('expands an inclusive span across a month boundary', () => {
    expect(expandRange('2026-01-30..2026-02-02')).toEqual([
      '2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02',
    ])
  })

  it('rejects reversed and malformed entries', () => {
    expect(expandRange('2026-10-07..2026-10-01')).toEqual([])
    expect(expandRange('2026-02-30')).toEqual([])
    expect(expandRange('nope')).toEqual([])
    expect(expandRange(undefined)).toEqual([])
  })
})

describe('resolveHolidays', () => {
  it('uses the built-in snapshot by default', () => {
    const days = resolveHolidays({})
    expect(days).toContain('2026-10-01')
    expect(days).toContain('2025-01-01')
    // 2026-10-10 is a swap workday in the official announcement: it must not
    // count as a holiday, because DeepSeek bills weekends off-peak anyway and
    // the rule is weekday-based.
    expect(days).not.toContain('2026-10-10')
    expect(days).not.toContain('2025-02-08')
  })

  it('adds configured days and ranges, sorted and deduplicated', () => {
    const days = resolveHolidays({
      useBuiltinHolidays: false,
      holidays: ['2027-01-01', '2026-10-01'],
      holidayRanges: ['2027-02-06..2027-02-08', '2026-10-01'],
    })
    expect(days).toEqual([
      '2026-10-01', '2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08',
    ])
  })

  it('can disable the snapshot for a fully manual calendar', () => {
    const days = resolveHolidays({ useBuiltinHolidays: false, holidays: ['2027-05-01'] })
    expect(days).toEqual(['2027-05-01'])
  })
})

describe('syncYears', () => {
  it('fetches the current and next Beijing year by default', () => {
    expect(syncYears([], beijing(2026, 12, 31, 23))).toEqual([2026, 2027])
    // 16:30 UTC on 2026-12-31 is already 2027-01-01 in Beijing.
    expect(syncYears([], Date.UTC(2026, 11, 31, 16, 30))).toEqual([2027, 2028])
  })

  it('uses the configured years when present', () => {
    expect(syncYears([2028, 2027, 2027], beijing(2026, 10, 21))).toEqual([2027, 2028])
  })
})

describe('parseHolidayDocument', () => {
  it('keeps only no-work days', () => {
    const days = parseHolidayDocument(document(2026, [
      { name: '国庆节', date: '2026-10-01', isOffDay: true },
      { name: '国庆节', date: '2026-10-10', isOffDay: false },
      { name: 'broken', date: '10/10/2026', isOffDay: true },
    ]))
    expect(days).toEqual(['2026-10-01'])
  })

  it('returns an empty list for a malformed document', () => {
    expect(parseHolidayDocument(null)).toEqual([])
    expect(parseHolidayDocument({})).toEqual([])
  })
})

describe('fetchRemoteHolidays', () => {
  it('unions every fetched year', async () => {
    const urls = []
    vi.stubGlobal('fetch', async url => {
      urls.push(url)
      const year = Number(/\/(\d{4})\.json$/u.exec(url)[1])
      return {
        ok: true,
        json: async () => document(year, [{ date: `${String(year)}-01-01`, isOffDay: true }]),
      }
    })
    const days = await fetchRemoteHolidays({
      years: [2026, 2027],
      urlTemplate: 'https://example.test/{year}.json',
      timeoutMs: 1000,
    })
    expect(urls).toEqual(['https://example.test/2026.json', 'https://example.test/2027.json'])
    expect(days).toEqual(['2026-01-01', '2027-01-01'])
  })

  it('rejects the whole sync when one year fails', async () => {
    vi.stubGlobal('fetch', async url => (
      url.endsWith('2027.json')
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, json: async () => document(2026, [{ date: '2026-01-01', isOffDay: true }]) }
    ))
    await expect(fetchRemoteHolidays({
      years: [2026, 2027],
      urlTemplate: 'https://example.test/{year}.json',
      timeoutMs: 1000,
    })).rejects.toThrow('HTTP 404')
  })

  it('rejects a document without a day list', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ year: 2026 }) }))
    await expect(fetchRemoteHolidays({
      years: [2026],
      urlTemplate: 'https://example.test/{year}.json',
      timeoutMs: 1000,
    })).rejects.toThrow('no day list')
  })

  it('propagates a timeout rejection', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('timed out', 'TimeoutError')
    })
    await expect(fetchRemoteHolidays({
      years: [2026],
      urlTemplate: 'https://example.test/{year}.json',
      timeoutMs: 1000,
    })).rejects.toThrow('timed out')
  })
})

describe('built-in snapshot', () => {
  it('covers the published 2025 and 2026 announcements', () => {
    const days = BUILTIN_HOLIDAY_RANGES.flatMap(expandRange)
    // Spring Festival 2026: 2026-02-15..2026-02-23.
    expect(days).toContain('2026-02-15')
    expect(days).toContain('2026-02-23')
    // National Day 2025 ran 2025-10-01..2025-10-08.
    expect(days).toContain('2025-10-08')
  })
})
