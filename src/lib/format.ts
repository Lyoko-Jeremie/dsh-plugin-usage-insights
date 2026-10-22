/**
 * Display formatting for the usage panel.
 *
 * Every export is pure and pinned to `en-US` conventions so the panel renders
 * identical text on every host and the tests need no locale setup.
 */

/** Grouped-integer formatter behind {@link formatCount}. */
const COUNT_FORMAT = new Intl.NumberFormat('en-US')

/**
 * Format a token count with a compact `k`, `M` or `B` suffix.
 *
 * @param value - token count, normally a non-negative integer.
 * @returns `"999"`, `"1.2k"`, `"12k"`, `"1.2M"`; a negative value keeps its sign.
 */
export function formatTokens(value: number): string {
  const sign = value < 0 ? '-' : ''
  const magnitude = Math.abs(value)
  if (magnitude < 1_000) return `${sign}${Math.round(magnitude)}`
  if (magnitude < 1_000_000) {
    const scaled = magnitude / 1_000
    // Three digits of a near-million round to `1000k`; report `1M` instead.
    if (scaled >= 999.5) return `${sign}${formatScaled(magnitude / 1_000_000)}M`
    return `${sign}${formatScaled(scaled)}k`
  }
  if (magnitude < 1_000_000_000) return `${sign}${formatScaled(magnitude / 1_000_000)}M`
  return `${sign}${formatScaled(magnitude / 1_000_000_000)}B`
}

/**
 * Render a unit-scaled count: one decimal below ten, whole numbers above it.
 *
 * @param scaled - count already divided by its unit scale.
 * @returns the numeric text without the unit suffix.
 */
function formatScaled(scaled: number): string {
  if (scaled >= 10) return `${Math.round(scaled)}`
  return scaled.toFixed(1).replace(/\.0$/, '')
}

/**
 * Format a plain count with thousands separators.
 *
 * @param value - count.
 * @returns `"999"` for 999, `"1,234"` for 1234.
 */
export function formatCount(value: number): string {
  return COUNT_FORMAT.format(value)
}

/**
 * Format a token count as an exact grouped integer.
 *
 * Token totals read as exact figures everywhere except the context window and
 * the per-request ledger, where a compact `k`/`M` unit keeps the narrow columns
 * readable.
 *
 * @param value - token count, normally a non-negative integer.
 * @returns `"275,123,456"`.
 */
export function formatTokenCount(value: number): string {
  return COUNT_FORMAT.format(Math.round(value))
}

/**
 * Format a ratio as a percentage of a whole.
 *
 * A ratio above 0.995 but below 1 keeps one decimal, so a nearly full figure
 * reads `"99.6%"` instead of rounding up to a misleading `"100%"`.
 *
 * @param ratio - fraction of a whole; values outside [0, 1] are clamped.
 * @returns `"78%"`, `"99.6%"`, `"100%"`.
 */
export function formatPercent(ratio: number): string {
  const clamped = Math.min(1, Math.max(0, ratio))
  if (clamped > 0.995 && clamped < 1) return `${(clamped * 100).toFixed(1)}%`
  return `${Math.round(clamped * 100)}%`
}

/**
 * Format a duration in milliseconds for a metrics tile.
 *
 * @param ms - elapsed milliseconds; negative input reads as zero.
 * @returns `"0.4s"`, `"45.2s"`, `"2m42s"`, `"1h2m"`.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, ms)
  // Below a minute one decimal is enough; the cutoff keeps 59.96s from
  // rounding up to "60.0s" instead of the cleaner "1m0s".
  if (total < 59_950) return `${(total / 1_000).toFixed(1)}s`
  const totalSeconds = Math.round(total / 1_000)
  if (totalSeconds < 3_600) return `${Math.floor(totalSeconds / 60)}m${totalSeconds % 60}s`
  const totalMinutes = Math.floor(totalSeconds / 60)
  return `${Math.floor(totalMinutes / 60)}h${totalMinutes % 60}m`
}

/**
 * Format a provider decode speed.
 *
 * @param value - output tokens per second; negative input reads as zero.
 * @returns `"42.3 tok/s"`; speeds of 100 or more drop the decimal.
 */
export function formatTokensPerSecond(value: number): string {
  const magnitude = Math.max(0, value)
  if (magnitude >= 100) return `${Math.round(magnitude)} tok/s`
  return `${magnitude.toFixed(1).replace(/\.0$/, '')} tok/s`
}

/**
 * Format an amount held in micro units as currency text.
 *
 * Amounts are integer millionths of the currency because one conversation's
 * cost is routinely below one cent. Sub-cent totals keep enough decimals to
 * stay non-zero; totals of one unit or more round to cents.
 *
 * @param micros - amount in micro units (1e-6 of the currency).
 * @param currency - ISO 4217 code the price table is denominated in.
 * @returns `"$0.00"`, `"$0.0123"`, `"$1.23"`.
 */
export function formatMoney(micros: number, currency: string): string {
  const amount = micros / 1_000_000
  const magnitude = Math.abs(amount)
  // Keep three to six significant digits on the sub-cent totals the panel shows.
  let fractionDigits =
    magnitude >= 1 ? 2 : magnitude >= 0.1 ? 3 : magnitude >= 0.01 ? 4 : magnitude >= 0.001 ? 5 : 6
  // A sub-cent total can round up to one full unit; show that one with cents.
  if (fractionDigits > 2 && Math.round(magnitude * 10 ** fractionDigits) >= 10 ** fractionDigits) {
    fractionDigits = 2
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: fractionDigits,
  }).format(amount)
}

/**
 * Format a cost amount that may span two billing bands.
 *
 * A table with peak and off-peak rates cannot attribute a cumulative total to
 * one band, so the panel shows the bounds the real amount falls between.
 *
 * @param micros - lower-bound amount in micro units.
 * @param microsMax - upper-bound amount in micro units, or undefined for one band.
 * @param currency - ISO 4217 code the price table is denominated in.
 * @returns `"¥3.70"`, or `"¥3.70 – ¥7.40"` when the bounds differ.
 */
export function formatMoneyRange(micros: number, microsMax: number | undefined, currency: string): string {
  const low = formatMoney(micros, currency)
  if (microsMax === undefined || microsMax === micros) return low
  return `${low} – ${formatMoney(microsMax, currency)}`
}

/**
 * Format one request start in Beijing time, the billing table's time zone.
 *
 * @param atMs - Unix epoch milliseconds.
 * @returns `"MM-DD HH:mm"` in Beijing time.
 */
export function formatBeijingTime(atMs: number): string {
  const date = new Date(atMs + 8 * 60 * 60 * 1000)
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  const hours = date.getUTCHours()
  const minutes = date.getUTCMinutes()
  const pad = (value: number): string => (value < 10 ? `0${value}` : `${value}`)
  return `${pad(month)}-${pad(day)} ${pad(hours)}:${pad(minutes)}`
}
