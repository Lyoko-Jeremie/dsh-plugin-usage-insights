/**
 * Mainland Chinese statutory holidays for billing-band attribution.
 *
 * DeepSeek bills peak hours on Beijing weekdays *excluding statutory holidays*,
 * so the band fold needs the holiday calendar. Two sources, combined:
 *
 * - a built-in snapshot of the State Council announcement (2024-11 for 2025,
 *   2025-11 for 2026), extracted from the community-maintained
 *   `NateScarlet/holiday-cn` dataset that mirrors the official papers;
 * - operator configuration (`holidays` dates plus `holidayRanges` spans),
 *   for a year the snapshot does not cover or for a correction;
 * - optionally, a live sync from that dataset when `holidaySync.enabled`.
 *
 * Weekends stay off-peak regardless of the swap-workday scheme: DeepSeek's
 * rule is "Monday to Friday excluding statutory holidays", so a Saturday that
 * the State Council turns into a workday is still billed off-peak here. Only
 * days with `isOffDay: true` enter the calendar.
 *
 * @module dsh-usage-insights/host/holidays
 */

/** First and last day of a range the dataset reports. */
const RANGE_SEPARATOR = '..'

/**
 * Statutory no-work days published for 2025 and 2026, as inclusive ranges in
 * Beijing time. Sources: gov.cn 2024-11 and 2025-11 announcements, read through
 * <https://github.com/NateScarlet/holiday-cn>.
 */
export const BUILTIN_HOLIDAY_RANGES = Object.freeze([
  // 2025
  '2025-01-01',
  '2025-01-28..2025-02-04',
  '2025-04-04..2025-04-06',
  '2025-05-01..2025-05-05',
  '2025-05-31..2025-06-02',
  '2025-10-01..2025-10-08',
  // 2026
  '2026-01-01..2026-01-03',
  '2026-02-15..2026-02-23',
  '2026-04-04..2026-04-06',
  '2026-05-01..2026-05-05',
  '2026-06-19..2026-06-21',
  '2026-09-25..2026-09-27',
  '2026-10-01..2026-10-07',
])

/** Matches one `YYYY-MM-DD` day. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

/** Milliseconds in one UTC day. */
const DAY_MS = 86_400_000

/**
 * Expand one range or day into Beijing calendar-day keys.
 *
 * @param entry - `YYYY-MM-DD` or `YYYY-MM-DD..YYYY-MM-DD`.
 * @returns the covered days in ascending order; empty when the entry is malformed.
 */
export function expandRange(entry) {
  if (typeof entry !== 'string') return []
  const [from, to] = entry.split(RANGE_SEPARATOR)
  const start = parseDay(from)
  const end = to === undefined ? start : parseDay(to)
  if (start === null || end === null || end < start) return []
  const days = []
  for (let time = start; time <= end; time += DAY_MS) days.push(dayKey(time))
  return days
}

/**
 * Parse one `YYYY-MM-DD` day into a UTC midnight timestamp.
 *
 * @param value - candidate day string.
 * @returns the timestamp, or null when the string is not a calendar day.
 */
function parseDay(value) {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const time = Date.UTC(year, month - 1, day)
  return dayKey(time) === value ? time : null
}

/**
 * Format a UTC midnight timestamp as `YYYY-MM-DD`.
 *
 * @param time - UTC midnight timestamp.
 * @returns the day key.
 */
function dayKey(time) {
  const date = new Date(time)
  const pad = value => (value < 10 ? `0${value}` : `${value}`)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/**
 * Merge day lists into one sorted, duplicate-free list.
 *
 * @param lists - day lists to union.
 * @returns the merged days.
 */
export function unionDays(...lists) {
  const days = new Set()
  for (const list of lists) for (const day of list) days.add(day)
  return [...days].sort()
}

/**
 * Resolve the holiday calendar from built-ins and operator configuration.
 *
 * @param config - resolved plugin settings.
 * @returns the sorted holiday days.
 */
export function resolveHolidays(config) {
  const builtin = config.useBuiltinHolidays === false
    ? []
    : BUILTIN_HOLIDAY_RANGES.flatMap(expandRange)
  const manual = (config.holidays ?? []).filter(day => typeof day === 'string' && DAY_PATTERN.test(day))
  const ranged = (config.holidayRanges ?? []).flatMap(expandRange)
  return unionDays(builtin, manual, ranged)
}

/**
 * Years a live sync should fetch: the configured list, or this year and the
 * next one in Beijing time (December dates can belong to the next year's
 * announcement).
 *
 * @param configured - operator-configured years.
 * @param now - epoch milliseconds used as "today".
 * @returns the year list, ascending.
 */
export function syncYears(configured, now = Date.now()) {
  if (Array.isArray(configured) && configured.length > 0) {
    return [...new Set(configured)].sort((left, right) => left - right)
  }
  const beijing = new Date(now + 8 * 60 * 60 * 1000)
  return [beijing.getUTCFullYear(), beijing.getUTCFullYear() + 1]
}

/**
 * Parse one `holiday-cn` document into its no-work days.
 *
 * @param document - parsed JSON document.
 * @returns the `isOffDay: true` days; empty for a malformed document.
 */
export function parseHolidayDocument(document) {
  const days = Array.isArray(document?.days) ? document.days : []
  const holidays = []
  for (const day of days) {
    if (day !== null && typeof day === 'object' && day.isOffDay === true && typeof day.date === 'string' && DAY_PATTERN.test(day.date)) {
      holidays.push(day.date)
    }
  }
  return holidays
}

/**
 * Fetch the holiday dataset for the given years.
 *
 * Any failed response rejects the whole sync: a partial calendar would silently
 * move requests into the wrong band, so the caller falls back to the built-in
 * snapshot instead.
 *
 * @param options - years, URL template with `{year}`, and a timeout.
 * @returns the union of the fetched years' no-work days.
 * @throws when a request fails, times out, or returns a malformed document.
 */
export async function fetchRemoteHolidays(options) {
  const lists = []
  for (const year of options.years) {
    const url = options.urlTemplate.replaceAll('{year}', String(year))
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs),
    })
    if (!response.ok) throw new Error(`holiday sync ${url} returned HTTP ${String(response.status)}`)
    const document = await response.json()
    if (!Array.isArray(document?.days)) throw new Error(`holiday sync ${url} returned no day list`)
    lists.push(parseHolidayDocument(document))
  }
  return unionDays(...lists)
}
