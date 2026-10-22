/**
 * Per-child-agent usage summary for the root agent's panel.
 *
 * A delegated conversation (subagent or Agent Teams teammate) is its own
 * Session with its own usage projections. This module turns those projections
 * into one table row each, priced the same way the history page prices a
 * conversation: exact when the per-band rollup exists, an amount range when
 * only cumulative counters exist.
 */
import type {
  ChildAgentView, CostBasis, CostView, ModelRef, PricingTable, TokenBuckets, UsageBandsView,
} from '../client/contract.ts'
import { mergeCosts, priceBuckets, priceBucketsInBand } from './pricing.ts'

/** One child conversation's raw inputs. */
export interface ChildAgentInput {
  id: string
  /** Display title shown in the table; the row falls back to the id when absent. */
  title: string
  running: boolean
  updatedAt: number
  tokenUsage?: TokenBuckets
  bands?: UsageBandsView
  /** Whole-log step count; the request count when no band rollup exists. */
  steps?: number
  model: ModelRef | null
}

/**
 * Summarize direct child conversations.
 *
 * @param inputs - child conversations and their projections.
 * @param pricing - plugin price table.
 * @returns one row per child, largest token total first.
 */
export function summarizeChildAgents(
  inputs: readonly ChildAgentInput[],
  pricing: PricingTable,
): ChildAgentView[] {
  const rows = inputs.map(input => summarize(input, pricing))
  return rows.sort((left, right) =>
    right.totalTokens - left.totalTokens
    || left.title.localeCompare(right.title))
}

/**
 * Summarize one child conversation.
 *
 * @param input - child conversation and projections.
 * @param pricing - plugin price table.
 * @returns the table row.
 */
function summarize(input: ChildAgentInput, pricing: PricingTable): ChildAgentView {
  const bands = input.bands
  const buckets = bands === undefined
    ? normalize(input.tokenUsage)
    : bandBuckets(bands)
  const billed = buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
  const priced = bands === undefined
    ? priceRange(input.tokenUsage, input.model, pricing)
    : priceBandRollup(bands, input.model, pricing)
  return {
    id: input.id,
    title: input.title.length > 0 ? input.title : input.id,
    running: input.running,
    updatedAt: input.updatedAt,
    requests: bands === undefined ? (input.steps ?? 0) : bandRequests(bands),
    totalTokens: sumBuckets(buckets),
    cacheRate: billed > 0 ? buckets.cacheReadTokens / billed : null,
    cost: priced.cost,
    costBasis: priced.basis,
  }
}

/**
 * Sum one rollup's lifetime buckets.
 *
 * @param bands - per-day, per-band rollup.
 * @returns the summed buckets.
 */
function bandBuckets(bands: UsageBandsView): TokenBuckets {
  const totals = normalize(undefined)
  for (const entry of [...bands.total.peak, ...bands.total.offPeak]) {
    totals.uncachedInputTokens += entry.uncachedInputTokens
    totals.cacheReadTokens += entry.cacheReadTokens
    totals.cacheWriteTokens += entry.cacheWriteTokens
    totals.outputTokens += entry.outputTokens
  }
  return totals
}

/**
 * Count one rollup's lifetime requests.
 *
 * @param bands - per-day, per-band rollup.
 * @returns the billed request count.
 */
function bandRequests(bands: UsageBandsView): number {
  let requests = 0
  for (const entry of [...bands.total.peak, ...bands.total.offPeak]) requests += entry.requests
  return requests
}

/**
 * Price one rollup exactly, per band and model.
 *
 * @param bands - per-day, per-band rollup.
 * @param fallback - route for entries the log could not attribute.
 * @param pricing - plugin price table.
 * @returns the merged cost and its basis.
 */
function priceBandRollup(
  bands: UsageBandsView,
  fallback: ModelRef | null,
  pricing: PricingTable,
): { cost: CostView | null; basis: CostBasis } {
  let cost: CostView | null = null
  let unpriced = false
  for (const [band, entries] of [['peak', bands.total.peak], ['off-peak', bands.total.offPeak]] as const) {
    for (const entry of entries) {
      const route = entry.provider.length > 0 && entry.model.length > 0
        ? { provider: entry.provider, model: entry.model }
        : fallback
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
  if (cost === null) return { cost: null, basis: 'none' }
  return { cost: unpriced ? { ...cost, complete: false } : cost, basis: 'bands' }
}

/**
 * Price cumulative counters as a peak/off-peak range.
 *
 * @param usage - cumulative buckets, or undefined before the first request.
 * @param model - route of the conversation.
 * @param pricing - plugin price table.
 * @returns the cost and its basis.
 */
function priceRange(
  usage: TokenBuckets | undefined,
  model: ModelRef | null,
  pricing: PricingTable,
): { cost: CostView | null; basis: CostBasis } {
  if (usage === undefined) return { cost: null, basis: 'none' }
  const cost = priceBuckets(pricing, model, usage)
  return { cost, basis: cost === null ? 'none' : 'range' }
}

/**
 * Copy usage buckets, defaulting a missing value to zero.
 *
 * @param usage - projection value, or undefined.
 * @returns a fresh bucket object.
 */
function normalize(usage: TokenBuckets | undefined): TokenBuckets {
  return {
    uncachedInputTokens: usage?.uncachedInputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
  }
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
