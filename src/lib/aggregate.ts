/**
 * Cross-conversation aggregation for the usage history panel.
 *
 * Every figure counts the *requests* that fall inside the selected range, not
 * the conversations whose last activity does. A conversation that spans several
 * days therefore contributes each request to its own day instead of pushing its
 * whole lifetime total onto the day it was last touched. Three sources, in order
 * of preference:
 *
 * - `steps`: the recent requests with their start times. When the Host's window
 *   covers every request of the conversation, the range filter is exact to the
 *   second and the day split follows each request.
 * - `bands`: the per-day, per-band rollup. It covers the Host's retained day
 *   window and filters by Beijing day, so an hour-precise range is rounded out
 *   to the day boundary.
 * - Neither: the conversation's cumulative counters are priced as a peak /
 *   off-peak range and attributed to the day of its last activity.
 *
 * The view reports which basis it used, so a partially migrated catalog cannot
 * pass an estimate off as exact.
 */
import type {
  AgentTotals, BandModelView, BandDayView, BandShareView, CostBasis, CostView, DayTotal, HistoryRange,
  HistorySessionInput, HistorySessionRow, HistoryView, PricingTable, TokenBuckets, UsageBandsView, UsageStepView,
} from '../client/contract.ts'
import type { BillingBand } from '../shared/band.js'
import { beijingDay } from '../shared/band.js'
import { addBandEntry, emptyBandShare } from './band-share.ts'
import { mergeCosts, priceBuckets, priceBucketsInBand } from './pricing.ts'

/** Milliseconds in one range day. */
const DAY_MS = 86_400_000

/** Length in days of the two bounded day-count ranges; `24h`, `today` and `all` derive their own cutoff. */
export const RANGE_DAYS = { '7d': 7, '30d': 30 } as const

/**
 * Start of the current Beijing calendar day.
 *
 * @param now - epoch milliseconds.
 * @returns the epoch milliseconds of that day's 00:00 in Beijing time.
 */
function beijingDayStart(now: number): number {
  return Date.parse(`${beijingDay(now)}T00:00:00+08:00`)
}

/**
 * Earliest activity time a range includes, or null for the unbounded range.
 *
 * `24h` is a rolling window; `today` starts at the Beijing midnight so its
 * figures match the daily chart's current-day bar.
 *
 * @param range - selected range.
 * @param now - epoch milliseconds.
 * @returns the inclusive cutoff, or null when every conversation qualifies.
 */
export function rangeCutoff(range: HistoryRange, now: number): number | null {
  switch (range) {
    case '24h': return now - DAY_MS
    case 'today': return beijingDayStart(now)
    case '7d': return now - RANGE_DAYS['7d'] * DAY_MS
    case '30d': return now - RANGE_DAYS['30d'] * DAY_MS
    case 'all': return null
  }
}

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
 * Whether a conversation's step window carries every request it ever made.
 *
 * @param steps - the conversation's step window.
 * @returns true when no request was folded out of the window.
 */
function isCompleteWindow(steps: NonNullable<HistorySessionInput['steps']>): boolean {
  return steps.omittedSteps === 0 && steps.steps.length === steps.totalSteps
}

/**
 * Split one conversation's requests into Beijing days inside the range.
 *
 * @param steps - requests with their start times.
 * @param cutoff - earliest start time the range includes, or null for all.
 * @returns ascending day rollups, each split by band and model; empty when no
 *   request falls in the range.
 */
function daysFromSteps(steps: readonly UsageStepView[], cutoff: number | null): BandDayView[] {
  const byDay = new Map<string, { peak: Map<string, BandModelView>; offPeak: Map<string, BandModelView> }>()
  for (const step of steps) {
    if (cutoff !== null && step.at < cutoff) continue
    const day = dayKey(step.at)
    let bucket = byDay.get(day)
    if (bucket === undefined) {
      bucket = { peak: new Map(), offPeak: new Map() }
      byDay.set(day, bucket)
    }
    const side = step.band === 'peak' ? bucket.peak : bucket.offPeak
    const key = `${step.provider}\u0000${step.model}`
    let entry = side.get(key)
    if (entry === undefined) {
      entry = {
        provider: step.provider,
        model: step.model,
        requests: 0,
        uncachedInputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      }
      side.set(key, entry)
    }
    entry.requests += 1
    entry.uncachedInputTokens += step.uncachedInputTokens
    entry.cacheReadTokens += step.cacheReadTokens
    entry.cacheWriteTokens += step.cacheWriteTokens
    entry.outputTokens += step.outputTokens
    entry.reasoningTokens += step.reasoningTokens
  }
  return [...byDay.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([day, bucket]) => ({
      day,
      peak: [...bucket.peak.values()],
      offPeak: [...bucket.offPeak.values()],
    }))
}

/**
 * Aggregate the in-range requests into the history view.
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
  const cutoff = rangeCutoff(input.range, input.now)
  const cutoffDay = cutoff === null ? null : beijingDay(cutoff)
  const buckets = emptyBuckets()
  const dayTotals = new Map<string, DayTotal>()
  const bandShare = emptyBandShare()
  let bandShareSeen = false
  let bandSharePartial = false
  const root = createAccumulator()
  const subagent = createAccumulator()
  const sessions: HistorySessionRow[] = []
  let consideredCount = 0
  let measuredCount = 0
  let fallbackCount = 0
  let cost: CostView | null = null
  let sawUnpriced = false
  let sawFallback = false
  let sawBands = false
  for (const session of input.sessions) {
    const kind = session.kind === 'subagent' ? subagent : root
    const steps = session.steps
    if (steps !== undefined && isCompleteWindow(steps)) {
      const days = daysFromSteps(steps.steps, cutoff)
      if (days.length === 0) continue
      consideredCount += 1
      kind.sessions += 1
      measuredCount += 1
      kind.measured += 1
      sawBands = true
      kind.sawBands = true
      bandShareSeen = true
      const activity = addDayActivity(days, buckets, kind, dayTotals, bandShare, input.pricing)
      const priced = activity.priced
      sessions.push(sessionRow(session, activity.buckets, priced?.cost ?? null, priced === null ? 'none' : 'bands'))
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
    const bands = session.bands
    if (bands !== undefined) {
      if (input.range === 'all') {
        // The retained day rows stop at the Host's window; the lifetime totals
        // are the only complete figure for an unbounded range.
        consideredCount += 1
        kind.sessions += 1
        measuredCount += 1
        kind.measured += 1
        sawBands = true
        kind.sawBands = true
        bandShareSeen = true
        const sessionBuckets = emptyBuckets()
        addBands(buckets, bands)
        addBands(kind, bands)
        addBands(sessionBuckets, bands)
        for (const day of bands.days) addBandDay(dayTotals, day, priceDay(input.pricing, day))
        for (const entry of bands.total.peak) addBandEntry(bandShare, entry, 'peak')
        for (const entry of bands.total.offPeak) addBandEntry(bandShare, entry, 'offPeak')
        const priced = priceBands(input.pricing, bands)
        sessions.push(sessionRow(
          session,
          sessionBuckets,
          priced?.cost ?? null,
          priced === null ? 'none' : 'bands',
        ))
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
      const days = bands.days.filter(day => cutoffDay === null || day.day >= cutoffDay)
      if (days.length === 0) continue
      consideredCount += 1
      kind.sessions += 1
      measuredCount += 1
      kind.measured += 1
      sawBands = true
      kind.sawBands = true
      bandShareSeen = true
      const activity = addDayActivity(days, buckets, kind, dayTotals, bandShare, input.pricing)
      const priced = activity.priced
      sessions.push(sessionRow(session, activity.buckets, priced?.cost ?? null, priced === null ? 'none' : 'bands'))
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
    if (usage === undefined) {
      if (cutoff === null || session.updatedAt >= cutoff) {
        consideredCount += 1
        kind.sessions += 1
      }
      continue
    }
    if (cutoff !== null && session.updatedAt < cutoff) continue
    consideredCount += 1
    kind.sessions += 1
    measuredCount += 1
    kind.measured += 1
    fallbackCount += 1
    bandSharePartial = true
    sawFallback = true
    kind.sawFallback = true
    addBuckets(buckets, usage)
    addBuckets(kind, usage)
    const sessionCost = priceBuckets(input.pricing, session.model, usage)
    addDay(dayTotals, session.updatedAt, usage, sessionCost)
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
    sessionCount: consideredCount,
    measuredCount,
    missingCount: consideredCount - measuredCount,
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

/**
 * Fold one conversation's in-range days into every running total.
 *
 * The day's amount is priced here, so the calendar table and the daily cost
 * chart are built from one pass over the same figure.
 *
 * @param days - ascending day rollups inside the range.
 * @param buckets - aggregate token buckets.
 * @param kind - mutable per-kind accumulator.
 * @param dayTotals - daily totals by day key.
 * @param bandShare - peak/off-peak share of the range.
 * @param pricing - plugin price table.
 * @returns the conversation's own token buckets and its priced amount.
 */
function addDayActivity(
  days: readonly BandDayView[],
  buckets: TokenBuckets,
  kind: KindAccumulator,
  dayTotals: Map<string, DayTotal>,
  bandShare: BandShareView,
  pricing: PricingTable,
): { buckets: TokenBuckets; priced: { cost: CostView | null; unpriced: boolean } | null } {
  const sessionBuckets = emptyBuckets()
  let cost: CostView | null = null
  let unpriced = false
  let seen = false
  for (const day of days) {
    if (day.peak.length > 0 || day.offPeak.length > 0) seen = true
    const dayPrice = priceDay(pricing, day)
    unpriced = unpriced || dayPrice.unpriced
    cost = combineCosts(cost, dayPrice.cost)
    addBandDay(dayTotals, day, dayPrice)
    addDayBuckets(sessionBuckets, day)
    for (const entry of day.peak) addBandEntry(bandShare, entry, 'peak')
    for (const entry of day.offPeak) addBandEntry(bandShare, entry, 'offPeak')
  }
  addBuckets(buckets, sessionBuckets)
  addBuckets(kind, sessionBuckets)
  return { buckets: sessionBuckets, priced: seen ? { cost, unpriced } : null }
}

/**
 * Add one day rollup's tokens to a bucket set.
 *
 * @param target - mutable buckets.
 * @param day - one Beijing day split by band.
 */
function addDayBuckets(target: TokenBuckets, day: BandDayView): void {
  for (const entry of [...day.peak, ...day.offPeak]) {
    target.uncachedInputTokens += entry.uncachedInputTokens
    target.cacheReadTokens += entry.cacheReadTokens
    target.cacheWriteTokens += entry.cacheWriteTokens
    target.outputTokens += entry.outputTokens
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
 * @param buckets - its in-range token counters.
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
 * @param sawBands - whether any conversation was split by request time.
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
 * @param priced - the day's amounts split by band.
 */
function addBandDay(totals: Map<string, DayTotal>, day: BandDayView, priced: DayPrice): void {
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
  const cost = priced.cost
  if (existing === undefined) {
    totals.set(day.day, {
      day: day.day, totalTokens, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, sessions,
      peakTokens, offPeakTokens, unattributedTokens: 0,
      costMicros: cost?.amountMicros ?? null,
      ...(cost?.amountMicrosMax !== undefined && cost.amountMicrosMax !== cost.amountMicros
        ? { costMicrosMax: cost.amountMicrosMax }
        : {}),
      peakCostMicros: priced.peak?.amountMicros ?? 0,
      offPeakCostMicros: priced.offPeak?.amountMicros ?? 0,
      otherCostMicros: 0,
      costUnpriced: priced.unpriced,
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
  existing.costUnpriced = existing.costUnpriced || priced.unpriced
  addCostAmount(existing, cost)
  existing.peakCostMicros += priced.peak?.amountMicros ?? 0
  existing.offPeakCostMicros += priced.offPeak?.amountMicros ?? 0
}

/**
 * Add one priced amount to an existing day total.
 *
 * @param target - the day total.
 * @param cost - the amount, or null when this part could not be priced.
 */
function addCostAmount(target: DayTotal, cost: CostView | null): void {
  if (cost === null) return
  const priorLow = target.costMicros ?? 0
  const priorHigh = target.costMicrosMax ?? priorLow
  const nextLow = priorLow + cost.amountMicros
  const nextHigh = priorHigh + (cost.amountMicrosMax ?? cost.amountMicros)
  target.costMicros = nextLow
  if (nextHigh !== nextLow) target.costMicrosMax = nextHigh
}

/**
 * Price one conversation's lifetime band rollup.
 *
 * @param pricing - plugin price table.
 * @param bands - the conversation's rollup.
 * @returns merged cost plus whether any entry stayed unpriced, or null when empty.
 */
function priceBands(
  pricing: PricingTable,
  bands: UsageBandsView,
): { cost: CostView | null; unpriced: boolean } | null {
  if (bands.total.peak.length === 0 && bands.total.offPeak.length === 0) return null
  const peak = priceBandEntries(pricing, bands.total.peak, 'peak')
  const offPeak = priceBandEntries(pricing, bands.total.offPeak, 'off-peak')
  return {
    cost: combineCosts(peak.cost, offPeak.cost),
    unpriced: peak.unpriced || offPeak.unpriced,
  }
}

/** One day's amount, split by the band each request ran in. */
interface DayPrice {
  /** Whole-day amount, or null when no entry of the day had a price. */
  cost: CostView | null
  /** Peak-band amount, or null when the day had no peak request. */
  peak: CostView | null
  /** Off-peak-band amount, or null when the day had no off-peak request. */
  offPeak: CostView | null
  /** Whether some entry of the day had no configured price. */
  unpriced: boolean
}

/**
 * Price one Beijing day.
 *
 * The two bands are priced separately, so the daily cost chart can stack them
 * like the daily token chart stacks their tokens.
 *
 * @param pricing - plugin price table.
 * @param day - one day split by band.
 * @returns the day's amount, its per-band parts, and whether anything stayed unpriced.
 */
function priceDay(pricing: PricingTable, day: BandDayView): DayPrice {
  const peak = priceBandEntries(pricing, day.peak, 'peak')
  const offPeak = priceBandEntries(pricing, day.offPeak, 'off-peak')
  return {
    cost: combineCosts(peak.cost, offPeak.cost),
    peak: peak.cost,
    offPeak: offPeak.cost,
    unpriced: peak.unpriced || offPeak.unpriced,
  }
}

/**
 * Price one band's model entries.
 *
 * @param pricing - plugin price table.
 * @param entries - one band's per-model counters.
 * @param band - the band those requests ran in.
 * @returns merged amount plus whether any entry stayed unpriced.
 */
function priceBandEntries(
  pricing: PricingTable,
  entries: readonly BandModelView[],
  band: BillingBand,
): { cost: CostView | null; unpriced: boolean } {
  let cost: CostView | null = null
  let unpriced = false
  for (const entry of entries) {
    const route = entry.provider.length > 0 && entry.model.length > 0
      ? { provider: entry.provider, model: entry.model }
      : null
    const priced = priceBucketsInBand(pricing, route, modelBuckets(entry), band)
    if (priced === null) {
      unpriced = true
      continue
    }
    cost = cost === null ? priced : mergeCosts(cost, priced)
  }
  return { cost, unpriced }
}

/**
 * Merge the two bands of one day.
 *
 * An absent side means the day ran no request in that band, not that a request
 * could not be priced, so it never marks the amount incomplete.
 *
 * @param left - peak amount or null.
 * @param right - off-peak amount or null.
 * @returns the combined amount, or null when both sides are absent.
 */
function combineCosts(left: CostView | null, right: CostView | null): CostView | null {
  if (left === null) return right
  if (right === null) return left
  return mergeCosts(left, right)
}

/**
 * Copy one model entry's token counters.
 *
 * @param entry - one model's counters inside one band.
 * @returns its four buckets.
 */
function modelBuckets(entry: BandModelView): TokenBuckets {
  return {
    uncachedInputTokens: entry.uncachedInputTokens,
    cacheReadTokens: entry.cacheReadTokens,
    cacheWriteTokens: entry.cacheWriteTokens,
    outputTokens: entry.outputTokens,
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
 * Add one fallback conversation to its activity day.
 *
 * Its amount comes from cumulative counters, so the day records it outside the
 * band split: the log never said which band those requests ran in.
 *
 * @param totals - day totals by key.
 * @param updatedAt - the conversation's last durable activity.
 * @param usage - the conversation's token buckets.
 * @param cost - the conversation's priced amount, or null when unpriced.
 */
function addDay(
  totals: Map<string, DayTotal>,
  updatedAt: number,
  usage: TokenBuckets,
  cost: CostView | null,
): void {
  const day = dayKey(updatedAt)
  const tokens = sumBuckets(usage)
  const amount = cost?.amountMicros ?? 0
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
      costMicros: cost?.amountMicros ?? null,
      ...(cost?.amountMicrosMax !== undefined && cost.amountMicrosMax !== cost.amountMicros
        ? { costMicrosMax: cost.amountMicrosMax }
        : {}),
      peakCostMicros: 0,
      offPeakCostMicros: 0,
      otherCostMicros: amount,
      costUnpriced: cost === null,
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
  existing.costUnpriced = existing.costUnpriced || cost === null
  addCostAmount(existing, cost)
  existing.otherCostMicros += amount
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
