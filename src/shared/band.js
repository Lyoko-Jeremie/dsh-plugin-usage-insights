/**
 * Beijing-time billing band arithmetic, shared by the Host fold and the panel.
 *
 * DeepSeek prices by Beijing time: peak is Monday-Friday 09:00-12:00 and
 * 14:00-18:00 excluding mainland Chinese holidays; every other hour, including
 * whole weekends, is off-peak at half the peak rate. Holidays cannot be derived
 * from a timestamp, so they arrive as configured `YYYY-MM-DD` keys.
 *
 * @module dsh-usage-insights/shared/band
 */

/** Beijing is UTC+8 all year (China observes no daylight saving). */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** Billing bands of the DeepSeek price list. */
export const BILLING_BANDS = Object.freeze(['peak', 'off-peak'])

/** Zero-pad a month or day to two digits. */
function pad(value) {
  return value < 10 ? `0${value}` : `${value}`
}

/**
 * Beijing calendar day of a timestamp.
 *
 * @param {number} atMs - Unix epoch milliseconds.
 * @returns {string} `YYYY-MM-DD` in Beijing time.
 */
export function beijingDay(atMs) {
  const date = new Date(atMs + BEIJING_OFFSET_MS)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/**
 * Billing band of one request start.
 *
 * @param {number} atMs - Unix epoch milliseconds of the request start.
 * @param {readonly string[]} [holidays] - Beijing `YYYY-MM-DD` holiday keys.
 * @returns {'peak' | 'off-peak'} the band the request is billed in.
 */
export function bandAt(atMs, holidays = []) {
  const date = new Date(atMs + BEIJING_OFFSET_MS)
  const day = beijingDay(atMs)
  if (holidays.includes(day)) return 'off-peak'
  const weekday = date.getUTCDay()
  if (weekday === 0 || weekday === 6) return 'off-peak'
  const hour = date.getUTCHours()
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18) ? 'peak' : 'off-peak'
}
