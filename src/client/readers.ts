/**
 * Readers for the projection wire values this plugin consumes.
 *
 * A slot component receives projection values as untyped framework data: the
 * projection keys are registered by other packages, and an assembly without
 * one of those packages serves `undefined`. These guards keep the panel
 * rendering (degraded, never crashing) when a value is absent or malformed; a
 * dropped slot entry would blank the whole tab.
 */
import type {
  BandDayView, BandModelView, BreakdownView, ModelRef, TokenBuckets, UsageBandsView, UsageStepView,
} from './contract.ts'

/** Projection value of the token meter's cumulative usage unit. */
export function readTokenUsage(value: unknown): TokenBuckets | undefined {
  if (!isRecord(value)) return undefined
  const uncachedInputTokens = count(value.uncachedInputTokens)
  const outputTokens = count(value.outputTokens)
  const cacheReadTokens = count(value.cacheReadTokens)
  const cacheWriteTokens = count(value.cacheWriteTokens)
  if (uncachedInputTokens === undefined || outputTokens === undefined) return undefined
  return {
    uncachedInputTokens,
    outputTokens,
    cacheReadTokens: cacheReadTokens ?? 0,
    cacheWriteTokens: cacheWriteTokens ?? 0,
  }
}

/** Projection value of the token meter's context-pressure unit. */
export function readContextPressure(value: unknown): {
  pressureTokens?: number
  projectedTokens?: number
  contextWindow?: number
} | undefined {
  if (!isRecord(value)) return undefined
  const pressureTokens = count(value.pressureTokens)
  const projectedTokens = count(value.projectedTokens)
  const contextWindow = count(value.contextWindow)
  if (pressureTokens === undefined && projectedTokens === undefined && contextWindow === undefined) return undefined
  return { pressureTokens, projectedTokens, contextWindow }
}

/** Projection value of the token meter's composition unit. */
export function readBreakdown(value: unknown): BreakdownView | undefined {
  if (!isRecord(value)) return undefined
  const systemTokens = count(value.systemTokens)
  const toolsTokens = count(value.toolsTokens)
  const messageTokens = count(value.messageTokens)
  if (systemTokens === undefined || toolsTokens === undefined || messageTokens === undefined) return undefined
  return { systemTokens, toolsTokens, messageTokens }
}

/** Projection value of the session-stats unit. */
export function readSessionStats(value: unknown): {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
} | undefined {
  if (!isRecord(value)) return undefined
  const turns = count(value.turns)
  const steps = count(value.steps)
  if (turns === undefined || steps === undefined) return undefined
  return {
    turns,
    steps,
    llmMs: count(value.llmMs) ?? 0,
    toolMs: count(value.toolMs) ?? 0,
    ttftMs: count(value.ttftMs) ?? 0,
    ttftSteps: count(value.ttftSteps) ?? 0,
    decodeMs: count(value.decodeMs) ?? 0,
    decodeTokens: count(value.decodeTokens) ?? 0,
  }
}

/** Projection value of the model-selection unit. */
export function readModelSelection(value: unknown): {
  lastUsed: ModelRef | null
  next: ModelRef | null
} | undefined {
  if (!isRecord(value)) return undefined
  return { lastUsed: readRoute(value.lastUsed), next: readRoute(value.next) }
}

/** Read one `{ provider, model }` route. */
function readRoute(value: unknown): ModelRef | null {
  if (!isRecord(value)) return null
  const provider = typeof value.provider === 'string' ? value.provider : ''
  const model = typeof value.model === 'string' ? value.model : ''
  return provider.length > 0 && model.length > 0 ? { provider, model } : null
}

/** Projection value of the Host's per-request unit. */
export function readSteps(value: unknown): {
  steps: UsageStepView[]
  totalSteps: number
  omittedSteps: number
} | undefined {
  if (!isRecord(value)) return undefined
  const list = value.steps
  if (!Array.isArray(list)) return undefined
  const steps: UsageStepView[] = []
  for (const entry of list) {
    const step = readStep(entry)
    if (step === undefined) return undefined
    steps.push(step)
  }
  return {
    steps,
    totalSteps: count(value.totalSteps) ?? steps.length,
    omittedSteps: count(value.omittedSteps) ?? 0,
  }
}

/** Projection value of the Host's per-day, per-band rollup. */
export function readBands(value: unknown): UsageBandsView | undefined {
  if (!isRecord(value)) return undefined
  const days = value.days
  const total = value.total
  if (!Array.isArray(days) || !isRecord(total)) return undefined
  const parsedDays: BandDayView[] = []
  for (const entry of days) {
    if (!isRecord(entry) || typeof entry.day !== 'string') return undefined
    const peak = readBandModels(entry.peak)
    const offPeak = readBandModels(entry.offPeak)
    if (peak === undefined || offPeak === undefined) return undefined
    parsedDays.push({ day: entry.day, peak, offPeak })
  }
  const peak = readBandModels(total.peak)
  const offPeak = readBandModels(total.offPeak)
  if (peak === undefined || offPeak === undefined) return undefined
  return { days: parsedDays, total: { peak, offPeak } }
}

/** One step record. */
function readStep(value: unknown): UsageStepView | undefined {
  if (!isRecord(value)) return undefined
  const at = count(value.at)
  const turn = count(value.turn)
  const step = count(value.step)
  if (at === undefined || turn === undefined || step === undefined) return undefined
  if (value.band !== 'peak' && value.band !== 'off-peak') return undefined
  const buckets = readTokenUsage(value)
  if (buckets === undefined) return undefined
  return {
    at,
    turn,
    step,
    provider: typeof value.provider === 'string' ? value.provider : '',
    model: typeof value.model === 'string' ? value.model : '',
    band: value.band,
    uncachedInputTokens: buckets.uncachedInputTokens,
    cacheReadTokens: buckets.cacheReadTokens,
    cacheWriteTokens: buckets.cacheWriteTokens,
    outputTokens: buckets.outputTokens,
    reasoningTokens: count(value.reasoningTokens) ?? 0,
  }
}

/** One band's model entries. */
function readBandModels(value: unknown): BandModelView[] | undefined {
  if (!Array.isArray(value)) return undefined
  const entries: BandModelView[] = []
  for (const raw of value) {
    if (!isRecord(raw)) return undefined
    const requests = count(raw.requests)
    const uncachedInputTokens = count(raw.uncachedInputTokens)
    if (requests === undefined || uncachedInputTokens === undefined) return undefined
    entries.push({
      provider: typeof raw.provider === 'string' ? raw.provider : '',
      model: typeof raw.model === 'string' ? raw.model : '',
      requests,
      uncachedInputTokens,
      cacheReadTokens: count(raw.cacheReadTokens) ?? 0,
      cacheWriteTokens: count(raw.cacheWriteTokens) ?? 0,
      outputTokens: count(raw.outputTokens) ?? 0,
      reasoningTokens: count(raw.reasoningTokens) ?? 0,
    })
  }
  return entries
}

/** Whether a value is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Read a non-negative integer count. */
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
