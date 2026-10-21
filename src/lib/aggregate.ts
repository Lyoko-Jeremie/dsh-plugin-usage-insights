/**
 * Cross-conversation aggregation for the usage history panel.
 *
 * Conversations are attributed to the local calendar day of their last durable
 * activity. Tokens and priced cost are summed over the selected range; a
 * conversation without cached usage still counts as missing coverage.
 */
import type {
  CostView,
  DayTotal,
  HistoryRange,
  HistorySessionInput,
  HistoryView,
  PricingTable,
  TokenBuckets,
} from '../client/contract.ts'
import { mergeCosts, priceBuckets } from './pricing.ts'

/** Milliseconds in one range day. */
const DAY_MS = 86_400_000

/** Length in days of the two bounded history ranges; `all` has no cutoff. */
export const RANGE_DAYS = { '7d': 7, '30d': 30 } as const

/**
 * Local calendar day of a timestamp.
 *
 * @param time - epoch milliseconds.
 * @returns `YYYY-MM-DD` in the host's local time zone.
 */
export function dayKey(time: number): string {
  const date = new Date(time)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/**
 * Zero-pad a month or day to two digits.
 *
 * @param value - month (1-12) or day (1-31).
 * @returns two-character text.
 */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`
}

/**
 * Aggregate the in-range conversations into the history view.
 *
 * The range keeps conversations whose `updatedAt` is at or after the cutoff.
 * Measured conversations are grouped by `dayKey(updatedAt)`: a day appears only
 * when at least one conversation on it carried token usage, so the daily series
 * never shows zero-height days for rows the backfill has not reached yet. Cost
 * covers priced conversations only; one unpriced conversation makes the
 * aggregate incomplete without dropping its tokens from the token totals.
 *
 * @param input - conversations, range, current time and price table.
 * @returns the derived history view.
 */
export function aggregateHistory(input: {
  sessions: readonly HistorySessionInput[]
  range: HistoryRange
  now: number
  pricing: PricingTable
}): HistoryView {
  const cutoff = input.range === 'all' ? null : input.now - RANGE_DAYS[input.range] * DAY_MS
  const inRange =
    cutoff === null
      ? input.sessions
      : input.sessions.filter((session) => session.updatedAt >= cutoff)
  const buckets: TokenBuckets = {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  const dayTotals = new Map<string, DayTotal>()
  let measuredCount = 0
  let cost: CostView | null = null
  let sawUnpriced = false
  for (const session of inRange) {
    const usage = session.tokenUsage
    if (usage === undefined) continue
    measuredCount += 1
    addBuckets(buckets, usage)
    addDay(dayTotals, session.updatedAt, usage)
    const sessionCost = priceBuckets(input.pricing, session.model, usage)
    if (sessionCost === null) {
      sawUnpriced = true
    } else {
      cost = cost === null ? sessionCost : mergeCosts(cost, sessionCost)
    }
  }
  const billedInputTokens =
    buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
  const days = [...dayTotals.values()].sort((left, right) =>
    left.day < right.day ? -1 : left.day > right.day ? 1 : 0,
  )
  if (cost !== null && sawUnpriced) cost = { ...cost, complete: false }
  return {
    range: input.range,
    sessionCount: inRange.length,
    measuredCount,
    missingCount: inRange.length - measuredCount,
    buckets,
    totalTokens: sumBuckets(buckets),
    cacheRate: billedInputTokens > 0 ? buckets.cacheReadTokens / billedInputTokens : null,
    activeDays: days.length,
    days,
    cost,
  }
}

/**
 * Add one usage value into the running token totals.
 *
 * @param totals - mutable accumulator.
 * @param usage - usage to add.
 */
function addBuckets(totals: TokenBuckets, usage: TokenBuckets): void {
  totals.uncachedInputTokens += usage.uncachedInputTokens
  totals.outputTokens += usage.outputTokens
  totals.cacheReadTokens += usage.cacheReadTokens
  totals.cacheWriteTokens += usage.cacheWriteTokens
}

/**
 * Add one measured conversation to its local calendar day.
 *
 * @param totals - day totals by key.
 * @param updatedAt - the conversation's last durable activity.
 * @param usage - the conversation's token buckets.
 */
function addDay(totals: Map<string, DayTotal>, updatedAt: number, usage: TokenBuckets): void {
  const day = dayKey(updatedAt)
  const existing = totals.get(day)
  if (existing === undefined) {
    totals.set(day, {
      day,
      totalTokens: sumBuckets(usage),
      inputTokens: usage.uncachedInputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      sessions: 1,
    })
    return
  }
  existing.totalTokens += sumBuckets(usage)
  existing.inputTokens += usage.uncachedInputTokens
  existing.outputTokens += usage.outputTokens
  existing.cacheReadTokens += usage.cacheReadTokens
  existing.cacheWriteTokens += usage.cacheWriteTokens
  existing.sessions += 1
}

/**
 * Sum the four token buckets.
 *
 * @param buckets - token buckets.
 * @returns their total.
 */
function sumBuckets(buckets: TokenBuckets): number {
  return (
    buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens
  )
}
