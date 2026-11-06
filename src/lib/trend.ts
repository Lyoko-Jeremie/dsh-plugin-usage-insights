/**
 * Per-request trend of context occupancy and cache hit rate.
 *
 * The panel draws both series in the request ledger's own order, so this module
 * sorts the rows itself: a merged ledger arrives newest-first while a
 * child-free view arrives newest-last. The context ratio divides the billed
 * prompt by the route's declared window, the same ratio the context section
 * shows; the cache ratio is cache reads over that prompt.
 */
import type { UsageStepView } from '../client/contract.ts'

/** One request of the trend, oldest first. */
export interface StepTrendPoint {
  /** Request start, Unix epoch milliseconds. */
  at: number
  turn: number
  step: number
  /** Subagent row number of the request; null for the root conversation. */
  agentIndex: number | null
  /** Billed prompt size: uncached input plus cache reads and writes. */
  promptTokens: number
  /** Prompt size over the declared context capacity, in [0, 1]; null without capacity. */
  contextRatio: number | null
  /** Cache reads over the billed prompt, in [0, 1]; null when no input was billed. */
  cacheRatio: number | null
}

/** Request row the trend derives from; detail rows also carry an agent number. */
export interface StepTrendRow extends UsageStepView {
  /** Subagent row number, absent for the root conversation. */
  agentIndex?: number | null
}

/**
 * Clamp one finite ratio to [0, 1].
 *
 * @param value - computed ratio.
 * @returns the clamped ratio, or null for a non-finite value.
 */
function ratioOrNull(value: number): number | null {
  if (!Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value))
}

/**
 * Read one non-negative token count.
 *
 * @param value - projected count.
 * @returns the count, or 0 for a non-finite value.
 */
function tokenOrZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

/**
 * Derive the two trend series from the request rows.
 *
 * A request that billed no input carries no ratio at all: its prompt is not a
 * real occupancy sample, so the chart breaks the line instead of dropping it to
 * zero.
 *
 * @param steps - request rows of one conversation.
 * @param windowTokens - declared context capacity, or null without one.
 * @returns the points in ascending request order.
 */
export function stepTrendPoints(
  steps: readonly StepTrendRow[],
  windowTokens: number | null,
): StepTrendPoint[] {
  const capacity = windowTokens !== null && Number.isFinite(windowTokens) && windowTokens > 0
    ? windowTokens
    : null
  return [...steps]
    .sort((left, right) => left.at - right.at || left.turn - right.turn || left.step - right.step)
    .map(step => {
      const promptTokens = tokenOrZero(step.uncachedInputTokens)
        + tokenOrZero(step.cacheReadTokens)
        + tokenOrZero(step.cacheWriteTokens)
      return {
        at: step.at,
        turn: step.turn,
        step: step.step,
        agentIndex: step.agentIndex ?? null,
        promptTokens,
        contextRatio: capacity === null || promptTokens <= 0
          ? null
          : ratioOrNull(promptTokens / capacity),
        cacheRatio: promptTokens <= 0
          ? null
          : ratioOrNull(tokenOrZero(step.cacheReadTokens) / promptTokens),
      }
    })
}
