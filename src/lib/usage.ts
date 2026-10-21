/**
 * Derivation of the single-conversation usage panel view.
 *
 * The Host publishes plain projections; this module turns them into one view
 * object without touching the runtime. Every figure comes from the input, so
 * the same projections always render the same panel.
 */
import type {
  BreakdownView,
  ContextView,
  ModelRef,
  PricingTable,
  SessionUsageView,
  TokenBuckets,
} from '../client/contract.ts'
import { priceBuckets } from './pricing.ts'

/** Host projections one conversation view is derived from. */
export interface SessionUsageInput {
  /** Billed token buckets; absent until the first provider usage lands. */
  tokenUsage?: TokenBuckets
  /** Context-window pressure figures, in prompt tokens. */
  contextPressure?: {
    pressureTokens?: number
    projectedTokens?: number
    contextWindow?: number
  }
  /** Heuristic composition of the next request. */
  contextBreakdown?: BreakdownView
  /** Durable session statistics; the source of the request and latency figures. */
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
  /** Plugin-owned price table used for the cost estimate. */
  pricing: PricingTable
}

/**
 * Derive the panel view for one conversation.
 *
 * `requests` reuses the session-stats step count: v0.1 has no per-request usage
 * event, and a step is one provider call in practice.
 *
 * @param input - host projections plus the price table.
 * @returns the derived single-conversation view.
 */
export function deriveSessionUsage(input: SessionUsageInput): SessionUsageView {
  const buckets = normalizeBuckets(input.tokenUsage)
  const totalTokens = sumBuckets(buckets)
  const billedInputTokens =
    buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
  const stats = input.sessionStats
  const model = input.modelSelection?.next ?? input.modelSelection?.lastUsed ?? null
  return {
    buckets,
    totalTokens,
    billedInputTokens,
    cacheRate: billedInputTokens > 0 ? buckets.cacheReadTokens / billedInputTokens : null,
    requests: stats?.steps ?? 0,
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
    cost: priceBuckets(input.pricing, model, buckets),
    hasUsage: totalTokens > 0,
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
function deriveContext(pressure: SessionUsageInput['contextPressure']): ContextView {
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
