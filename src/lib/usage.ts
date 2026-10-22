/**
 * Derivation of the single-conversation view from Host projections.
 *
 * Pure: every figure is computed from the projection values the slot hands in,
 * plus the plugin price table. Nothing here reads the runtime, the clock, or
 * storage.
 */
import type {
  BandModelView, BreakdownView, CostBasis, CostView, ModelRef, PricingTable,
  SessionUsageView, StepActivityView, StepDetailView, TokenBuckets, UsageBandsView, UsageStepView,
} from '../client/contract.ts'
import { bandShareOf } from './band-share.ts'
import { mergeCosts, priceBuckets, priceBucketsInBand } from './pricing.ts'

/** Inputs of {@link deriveSessionUsage}: projection values plus the price table. */
export interface SessionUsageInput {
  /** Cumulative provider usage of the whole durable log. */
  tokenUsage?: TokenBuckets
  /** Newest request pressure and route capacity. */
  contextPressure?: {
    pressureTokens?: number
    projectedTokens?: number
    contextWindow?: number
  }
  /** Heuristic composition of the next request. */
  contextBreakdown?: BreakdownView
  /** Whole-log turn and wall-time figures. */
  sessionStats?: {
    turns: number
    steps: number
    llmMs: number
    toolMs: number
    ttftMs: number
    ttftSteps: number
    decodeMs: number
    decodeTokens: number
  }
  /** Route of the last request and the route the next one will use. */
  modelSelection?: { lastUsed: ModelRef | null; next: ModelRef | null }
  /** Raw `usageSteps` view, when the Host projection is mounted. */
  steps?: { steps: readonly UsageStepView[]; totalSteps: number; omittedSteps: number } | null
  /** Raw `usageBands` view, when the Host projection is mounted. */
  bands?: UsageBandsView | null
  /** Plugin-owned price table. */
  pricing: PricingTable
}

/**
 * Derive the panel view for one conversation.
 *
 * Cost is exact when the Host's per-band rollup is available: every bucket is
 * priced in the band its request actually ran in. Without that projection the
 * cumulative counters are priced as a peak/off-peak range instead.
 *
 * @param input - Host projections plus the price table.
 * @returns the derived single-conversation view.
 */
export function deriveSessionUsage(input: SessionUsageInput): SessionUsageView {
  const buckets = normalizeBuckets(input.tokenUsage)
  const totalTokens = sumBuckets(buckets)
  const billedInputTokens =
    buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
  const stats = input.sessionStats
  const model = input.modelSelection?.next ?? input.modelSelection?.lastUsed ?? null
  const steps = decorateStepDetails(input.steps, model, input.pricing)
  const priced = deriveCost(input, model, buckets)
  return {
    buckets,
    totalTokens,
    billedInputTokens,
    cacheRate: billedInputTokens > 0 ? buckets.cacheReadTokens / billedInputTokens : null,
    requests: input.steps?.totalSteps ?? stats?.steps ?? 0,
    turns: stats?.turns ?? 0,
    steps: stats?.steps ?? 0,
    llmMs: stats?.llmMs ?? 0,
    toolMs: stats?.toolMs ?? 0,
    ttftAvgMs: stats !== undefined && stats.ttftSteps > 0 ? stats.ttftMs / stats.ttftSteps : null,
    decodeTps:
      stats !== undefined && stats.decodeMs > 0 ? stats.decodeTokens / (stats.decodeMs / 1_000) : null,
    context: deriveContext(input.contextPressure),
    breakdown: input.contextBreakdown ?? null,
    model,
    cost: priced.cost,
    costBasis: priced.basis,
    stepActivity: steps,
    bandShare: bandShareOf(input.bands),
    hasUsage: totalTokens > 0,
  }
}

/**
 * Price the session.
 *
 * @param input - projection values and price table.
 * @param model - route used when only the cumulative counters exist.
 * @param buckets - cumulative buckets.
 * @returns the cost view and how it was derived.
 */
function deriveCost(
  input: SessionUsageInput,
  model: ModelRef | null,
  buckets: TokenBuckets,
): { cost: CostView | null; basis: CostBasis } {
  const bands = input.bands
  if (bands !== null && bands !== undefined) {
    const peak = priceBand(bands.total.peak, 'peak', input.pricing, model)
    const offPeak = priceBand(bands.total.offPeak, 'off-peak', input.pricing, model)
    if (peak !== null || offPeak !== null) {
      // An empty band is not an unpriced band: merge only the bands that
      // actually carry requests, or the empty side would mark the result
      // incomplete.
      const peakCost = peak?.cost ?? null
      const offPeakCost = offPeak?.cost ?? null
      const merged = peakCost === null
        ? offPeakCost
        : offPeakCost === null ? peakCost : mergeCosts(peakCost, offPeakCost)
      if (merged !== null) {
        const complete = merged.complete && (peak?.unpriced !== true) && (offPeak?.unpriced !== true)
        return { cost: complete === merged.complete ? merged : { ...merged, complete }, basis: 'bands' }
      }
    }
  }
  return { cost: priceBuckets(input.pricing, model, buckets), basis: 'range' }
}

/**
 * Price one band's per-model entries.
 *
 * Requests whose log entry named no route (a failed attempt before the first
 * message) are priced at the session's current route, which is the only route
 * evidence available; they stay unpriced only when that route is unpriced too.
 *
 * @param entries - one band's model buckets.
 * @param band - billing band.
 * @param pricing - plugin price table.
 * @param fallback - route for entries the log could not attribute.
 * @returns merged cost plus whether any entry stayed unpriced, or null when empty.
 */
function priceBand(
  entries: readonly BandModelView[],
  band: 'peak' | 'off-peak',
  pricing: PricingTable,
  fallback: ModelRef | null,
): { cost: CostView | null; unpriced: boolean } | null {
  if (entries.length === 0) return null
  let cost: CostView | null = null
  let unpriced = false
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
  return { cost, unpriced }
}

/**
 * Turn a Host step list into table rows with their own price.
 *
 * Rows start without an agent number: the conversation's own requests are the
 * root agent's, and child rows are numbered when a root panel merges them.
 *
 * @param raw - the `usageSteps` view, or undefined when the projection is absent.
 * @param fallback - route for steps whose log entry named none.
 * @param pricing - plugin price table.
 * @returns step rows, or null without the projection.
 */
export function decorateStepDetails(
  raw: SessionUsageInput['steps'],
  fallback: ModelRef | null,
  pricing: PricingTable,
): StepActivityView | null {
  if (raw === null || raw === undefined) return null
  const steps: StepDetailView[] = raw.steps.map(step => ({
    ...step,
    agentIndex: null,
    cost: priceBucketsInBand(pricing, routeOf(step) ?? fallback, bucketsOf(step), step.band),
  }))

  return { steps, totalSteps: raw.totalSteps, omittedSteps: raw.omittedSteps }
}

/**
 * Route of one step.
 *
 * @param step - one step.
 * @returns the route, or null when the log did not name one.
 */
function routeOf(step: UsageStepView): ModelRef | null {
  return step.provider.length > 0 && step.model.length > 0
    ? { provider: step.provider, model: step.model }
    : null
}

/**
 * Token buckets of one step.
 *
 * @param step - one step.
 * @returns its four buckets.
 */
function bucketsOf(step: UsageStepView): TokenBuckets {
  return {
    uncachedInputTokens: step.uncachedInputTokens,
    cacheReadTokens: step.cacheReadTokens,
    cacheWriteTokens: step.cacheWriteTokens,
    outputTokens: step.outputTokens,
  }
}

/**
 * Copy a usage value into four concrete buckets, defaulting missing ones to zero.
 *
 * @param usage - projection value, or undefined before the first usage.
 * @returns a fresh bucket object safe to hand to presentational components.
 */
function normalizeBuckets(usage: TokenBuckets | undefined): TokenBuckets {
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

/**
 * Derive context occupancy, preferring the projected next-request size.
 *
 * @param pressure - context-pressure projection, or undefined.
 * @returns occupancy view; every figure is null without a projection.
 */
function deriveContext(pressure: SessionUsageInput['contextPressure']): SessionUsageView['context'] {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens ?? null
  const windowTokens = pressure?.contextWindow ?? null
  const source =
    pressure?.projectedTokens !== undefined
      ? 'projected'
      : pressure?.pressureTokens !== undefined
        ? 'pressure'
        : null
  const ratio =
    usedTokens !== null && windowTokens !== null && windowTokens > 0
      ? Math.min(1, Math.max(0, usedTokens / windowTokens))
      : null
  return { usedTokens, windowTokens, ratio, source }
}
