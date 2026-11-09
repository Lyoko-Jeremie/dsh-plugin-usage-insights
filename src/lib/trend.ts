/**
 * Per-request trend of context occupancy, cache hit rate and billed amount.
 *
 * The panel draws both series in the request ledger's own order, so this module
 * sorts the rows itself: a merged ledger arrives newest-first while a
 * child-free view arrives newest-last. The context ratio divides the billed
 * prompt by the route's declared window, the same ratio the context section
 * shows; the cache ratio is cache reads over that prompt.
 */
import { HIT_GOOD_RATIO, HIT_WARN_RATIO, hitBarRatio } from './hit-scale.ts'
import type { HitLevel } from './hit-scale.ts'
import type { CostView, UsageStepView } from '../client/contract.ts'

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
  /** Billed amount of the request; null without a configured price. */
  amountMicros: number | null
  /** Currency of {@link amountMicros}; null when the request stayed unpriced. */
  amountCurrency: string | null
}

/** Request row the trend derives from; detail rows also carry an agent number. */
export interface StepTrendRow extends UsageStepView {
  /** Subagent row number, absent for the root conversation. */
  agentIndex?: number | null
  /** Priced amount of the request, absent on rows that carry no price view. */
  cost?: CostView | null
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
 * Derive the trend series from the request rows.
 *
 * A request that billed no input carries no ratio at all: its prompt is not a
 * real occupancy sample, so the chart breaks the line instead of dropping it to
 * zero. The amount series takes the request's priced amount and breaks the same
 * way when the request had no configured price.
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
      const cost = step.cost ?? null
      const amountMicros = cost !== null && Number.isFinite(cost.amountMicros)
        ? Math.max(0, cost.amountMicros)
        : null
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
        amountMicros,
        amountCurrency: cost === null || amountMicros === null ? null : cost.currency,
      }
    })
}

/** One same-colour slice of a segment between two cache-hit samples. */
export interface HitSegmentPart {
  /** Slice start as a fraction of the parent segment, in [0, 1]. */
  from: number
  /** Slice end as a fraction of the parent segment, in [0, 1]. */
  to: number
  /** Status colour the slice takes. */
  level: Exclude<HitLevel, 'none'>
}

/**
 * Split one segment between two cache-hit samples at the status thresholds.
 *
 * The plot maps a hit rate through the power scale, so a straight segment can
 * cross both the 90% and 70% levels. The slice boundaries are the screen
 * positions of those levels, which keeps each colour aligned with the
 * horizontal guides: a segment that runs from green through yellow into red
 * therefore shows all three colours across its own length.
 *
 * @param from - hit rate at the segment start, in [0, 1].
 * @param to - hit rate at the segment end, in [0, 1].
 * @returns slices in drawing order; a segment inside one level returns one.
 */
export function hitSegmentParts(from: number, to: number): HitSegmentPart[] {
  const start = hitBarRatio(from)
  const end = hitBarRatio(to)
  const goodEdge = hitBarRatio(HIT_GOOD_RATIO)
  const warnEdge = hitBarRatio(HIT_WARN_RATIO)
  const cuts = [0, 1]
  if (start !== end) {
    for (const edge of [goodEdge, warnEdge]) {
      const at = (edge - start) / (end - start)
      if (at > 0 && at < 1) cuts.push(at)
    }
  }
  cuts.sort((left, right) => left - right)
  const parts: HitSegmentPart[] = []
  for (let index = 1; index < cuts.length; index += 1) {
    const fromT = cuts[index - 1] ?? 0
    const toT = cuts[index] ?? 1
    if (toT - fromT < 1e-9) continue
    const middle = start + (end - start) * ((fromT + toT) / 2)
    const level = middle >= goodEdge ? 'good' : middle >= warnEdge ? 'warn' : 'bad'
    parts.push({ from: fromT, to: toT, level })
  }
  return parts
}
