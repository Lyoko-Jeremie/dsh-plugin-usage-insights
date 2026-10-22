/**
 * Cross-conversation aggregation for the usage history panel.
 *
 * Two sources, in order of preference:
 *
 * - A conversation's `usageBands` rollup names the day and the billing band of
 *   every request it counted, so tokens and cost are exact.
 * - Without that projection, the conversation's cumulative counters are priced
 *   as a peak/off-peak range and attributed to the day of its last activity.
 *
 * The view reports which basis it used, so a partially migrated catalog cannot
 * pass an estimate off as exact.
 */
import type {
  AgentTotals, BandModelView, BandDayView, CostBasis, CostView, DayTotal, HistoryRange,
  HistorySessionInput, HistorySessionRow, HistoryView, PricingTable, TokenBuckets, UsageBandsView,
} from '../client/contract.ts'
import { beijingDay } from '../shared/band.js'
import { addBandEntry, emptyBandShare } from './band-share.ts'
import { mergeCosts, priceBuckets, priceBucketsInBand } from './pricing.ts'

/** Milliseconds in one range day. */
const DAY_MS = 86_400_000

/** Length in days of the two bounded history ranges; `all` has no cutoff. */
export const RANGE_DAYS = { '7d': 7, '30d': 30 } as const

/**
 * Beijing calendar day of a timestamp, matching the Host rollup's day keys.
 *
 * @param time - epoch milliseconds.
 * @returns `YYYY-MM-DD` in Beijing time.
 */
export function dayKey(time: number): string {
  return beijingDay(time)
}

/**
 * Aggregate the in-range conversations into the history view.
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
  const cutoffDay = cutoff === null ? null : beijingDay(cutoff)
  const inRange =
    cutoff === null ? input.sessions : input.sessions.filter(session => session.updatedAt >= cutoff)
  const buckets: TokenBuckets = {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  const dayTotals = new Map<string, DayTotal>()
  const bandShare = emptyBandShare()
  let bandShareSeen = false
  let bandSharePartial = false
  const root = createAccumulator()
  const subagent = createAccumulator()
  const sessions: HistorySessionRow[] = []
  let measuredCount = 0
  let fallbackCount = 0
  let cost: CostView | null = null
  let sawUnpriced = false
  let sawFallback = false
  let sawBands = false
  for (const session of inRange) {
    const kind = session.kind === 'subagent' ? subagent : root
    kind.sessions += 1
    const bands = session.bands
    if (bands !== undefined) {
      measuredCount += 1
      kind.measured += 1
      sawBands = true
      kind.sawBands = true
      addBands(buckets, bands)
      addBands(kind, bands)
      bandShareSeen = true
      for (const entry of bands.total.peak) addBandEntry(bandShare, entry, 'peak')
      for (const entry of bands.total.offPeak) addBandEntry(bandShare, entry, 'offPeak')
      for (const day of bands.days) {
        if (cutoffDay !== null && day.day < cutoffDay) continue
        addBandDay(dayTotals, day)
      }
      const priced = priceBands(input.pricing, bands)
      const sessionBuckets = emptyBuckets()
      addBands(sessionBuckets, bands)
      sessions.push(sessionRow(session, sessionBuckets, priced?.cost ?? null, priced === null ? 'none' : 'bands'))
      if (priced === null) {
        sawUnpriced = true
        kind.sawUnpriced = true
      } else {
        cost = cost === null ? priced.cost : mergeCosts(cost, priced.cost)
        kind.cost = kind.cost === null ? priced.cost : mergeCosts(kind.cost, priced.cost)
        sawUnpriced = sawUnpriced || priced.unpriced
        kind.sawUnpriced = kind.sawUnpriced || priced.unpriced
      }
      continue
    }
    const usage = session.tokenUsage
    if (usage === undefined) continue
    measuredCount += 1
    kind.measured += 1
    fallbackCount += 1
    bandSharePartial = true
    sawFallback = true
    kind.sawFallback = true
    addBuckets(buckets, usage)
    addBuckets(kind, usage)
    addDay(dayTotals, session.updatedAt, usage)
    const sessionCost = priceBuckets(input.pricing, session.model, usage)
    sessions.push(sessionRow(session, usage, sessionCost, sessionCost === null ? 'none' : 'range'))
    if (sessionCost === null) {
      sawUnpriced = true
      kind.sawUnpriced = true
    } else {
      cost = cost === null ? sessionCost : mergeCosts(cost, sessionCost)
      kind.cost = kind.cost === null ? sessionCost : mergeCosts(kind.cost, sessionCost)
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
    fallbackCount,
    buckets,
    totalTokens: sumBuckets(buckets),
    cacheRate: billedInputTokens > 0 ? buckets.cacheReadTokens / billedInputTokens : null,
    activeDays: days.length,
    days,
    cost,
    costBasis: basisOf(cost, sawBands, sawFallback),
    agents: { root: finalize(root), subagent: finalize(subagent) },
    sessions: sessions.sort((left, right) =>
      right.totalTokens - left.totalTokens || left.title.localeCompare(right.title)),
    bandShare: bandShareSeen ? bandShare : null,
    bandSharePartial,
  }
}

/** Mutable per-kind accumulator behind {@link AgentTotals}. */
interface KindAccumulator extends TokenBuckets {
  sessions: number
  measured: number
  cost: CostView | null
  sawUnpriced: boolean
  sawBands: boolean
  sawFallback: boolean
}

/**
 * Build one conversation's row for the per-session table.
 *
 * @param session - the source conversation.
 * @param buckets - its token counters.
 * @param cost - priced amount, or null when no route could be priced.
 * @param costBasis - how the amount was derived.
 * @returns the table row.
 */
function sessionRow(
  session: HistorySessionInput,
  buckets: TokenBuckets,
  cost: CostView | null,
  costBasis: CostBasis,
): HistorySessionRow {
  const billed = buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
  return {
    id: session.id,
    title: session.title !== undefined && session.title.length > 0 ? session.title : session.id,
    kind: session.kind === 'subagent' ? 'subagent' : 'root',
    updatedAt: session.updatedAt,
    totalTokens: sumBuckets(buckets),
    cacheRate: billed > 0 ? buckets.cacheReadTokens / billed : null,
    cost,
    costBasis,
  }
}

/**
 * Create zeroed token buckets.
 *
 * @returns a fresh bucket object.
 */
function emptyBuckets(): TokenBuckets {
  return {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
}

/**
 * Create a zeroed per-kind accumulator.
 *
 * @returns the accumulator.
 */
function createAccumulator(): KindAccumulator {
  return {
    sessions: 0,
    measured: 0,
    cost: null,
    sawUnpriced: false,
    sawBands: false,
    sawFallback: false,
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
  }
}

/**
 * Finish one kind's accumulator.
 *
 * @param kind - mutable accumulator.
 * @returns the public totals.
 */
function finalize(kind: KindAccumulator): AgentTotals {
  const billed =
    kind.uncachedInputTokens + kind.cacheReadTokens + kind.cacheWriteTokens
  const cost = kind.cost !== null && kind.sawUnpriced ? { ...kind.cost, complete: false } : kind.cost
  return {
    sessions: kind.sessions,
    measured: kind.measured,
    totalTokens: sumBuckets(kind),
    cacheRate: billed > 0 ? kind.cacheReadTokens / billed : null,
    cost,
    costBasis: basisOf(cost, kind.sawBands, kind.sawFallback),
  }
}

/**
 * Decide how the aggregate's cost was derived.
 *
 * @param cost - aggregate cost, or null.
 * @param sawBands - whether any conversation contributed a band rollup.
 * @param sawFallback - whether any conversation fell back to cumulative counters.
 * @returns the basis label.
 */
function basisOf(cost: CostView | null, sawBands: boolean, sawFallback: boolean): CostBasis {
  if (cost === null) return 'none'
  if (sawBands && !sawFallback) return 'bands'
  return 'range'
}

/**
 * Add a band rollup's lifetime totals into the running buckets.
 *
 * @param totals - mutable accumulator.
 * @param bands - one conversation's rollup.
 */
function addBands(totals: TokenBuckets, bands: UsageBandsView): void {
  for (const entry of bands.total.peak) addModelBuckets(totals, entry)
  for (const entry of bands.total.offPeak) addModelBuckets(totals, entry)
}

/**
 * Add one model entry's buckets.
 *
 * @param totals - mutable accumulator.
 * @param entry - one model's counters.
 */
function addModelBuckets(totals: TokenBuckets, entry: BandModelView): void {
  totals.uncachedInputTokens += entry.uncachedInputTokens
  totals.cacheReadTokens += entry.cacheReadTokens
  totals.cacheWriteTokens += entry.cacheWriteTokens
  totals.outputTokens += entry.outputTokens
}

/**
 * Add one rollup day into the day totals.
 *
 * @param totals - day totals by key.
 * @param day - one Beijing day split by band.
 */
function addBandDay(totals: Map<string, DayTotal>, day: BandDayView): void {
  let totalTokens = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let sessions = 0
  let peakTokens = 0
  let offPeakTokens = 0
  for (const entry of day.peak) {
    const tokens = entry.uncachedInputTokens + entry.cacheReadTokens + entry.cacheWriteTokens + entry.outputTokens
    peakTokens += tokens
    inputTokens += entry.uncachedInputTokens
    outputTokens += entry.outputTokens
    cacheReadTokens += entry.cacheReadTokens
    cacheWriteTokens += entry.cacheWriteTokens
    totalTokens += tokens
    sessions += entry.requests
  }
  for (const entry of day.offPeak) {
    const tokens = entry.uncachedInputTokens + entry.cacheReadTokens + entry.cacheWriteTokens + entry.outputTokens
    offPeakTokens += tokens
    inputTokens += entry.uncachedInputTokens
    outputTokens += entry.outputTokens
    cacheReadTokens += entry.cacheReadTokens
    cacheWriteTokens += entry.cacheWriteTokens
    totalTokens += tokens
    sessions += entry.requests
  }
  const existing = totals.get(day.day)
  if (existing === undefined) {
    totals.set(day.day, {
      day: day.day, totalTokens, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, sessions,
      peakTokens, offPeakTokens, unattributedTokens: 0,
    })
    return
  }
  existing.totalTokens += totalTokens
  existing.inputTokens += inputTokens
  existing.outputTokens += outputTokens
  existing.cacheReadTokens += cacheReadTokens
  existing.cacheWriteTokens += cacheWriteTokens
  existing.sessions += sessions
  existing.peakTokens += peakTokens
  existing.offPeakTokens += offPeakTokens
}

/**
 * Price one conversation's band rollup.
 *
 * @param pricing - plugin price table.
 * @param bands - the conversation's rollup.
 * @returns merged cost plus whether any entry stayed unpriced, or null when empty.
 */
function priceBands(
  pricing: PricingTable,
  bands: UsageBandsView,
): { cost: CostView | null; unpriced: boolean } | null {
  let cost: CostView | null = null
  let unpriced = false
  let seen = false
  for (const [band, entries] of [['peak', bands.total.peak], ['off-peak', bands.total.offPeak]] as const) {
    for (const entry of entries) {
      seen = true
      const route = entry.provider.length > 0 && entry.model.length > 0
        ? { provider: entry.provider, model: entry.model }
        : null
      const priced = priceBucketsInBand(pricing, route, {
        uncachedInputTokens: entry.uncachedInputTokens,
        cacheReadTokens: entry.cacheReadTokens,
        cacheWriteTokens: entry.cacheWriteTokens,
        outputTokens: entry.outputTokens,
      }, band)
      if (priced === null) {
        unpriced = true
        continue
      }
      cost = cost === null ? priced : mergeCosts(cost, priced)
    }
  }
  return seen ? { cost, unpriced } : null
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
 * Add one fallback conversation to its activity day.
 *
 * @param totals - day totals by key.
 * @param updatedAt - the conversation's last durable activity.
 * @param usage - the conversation's token buckets.
 */
function addDay(totals: Map<string, DayTotal>, updatedAt: number, usage: TokenBuckets): void {
  const day = dayKey(updatedAt)
  const tokens = sumBuckets(usage)
  const existing = totals.get(day)
  if (existing === undefined) {
    totals.set(day, {
      day,
      totalTokens: tokens,
      inputTokens: usage.uncachedInputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      sessions: 1,
      peakTokens: 0,
      offPeakTokens: 0,
      unattributedTokens: tokens,
    })
    return
  }
  existing.totalTokens += tokens
  existing.inputTokens += usage.uncachedInputTokens
  existing.outputTokens += usage.outputTokens
  existing.cacheReadTokens += usage.cacheReadTokens
  existing.cacheWriteTokens += usage.cacheWriteTokens
  existing.sessions += 1
  existing.unattributedTokens += tokens
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
