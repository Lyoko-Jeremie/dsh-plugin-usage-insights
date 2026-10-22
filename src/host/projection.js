/**
 * Host-side session projections for per-step usage.
 *
 * The Harness logs one `assistant/message` (or `assistant/attempt` when a
 * delivery failed) per model request, each carrying provider usage, and stamps
 * every event with its append time. These units fold that log into two
 * client-visible values:
 *
 * - `usageSteps` keeps the most recent requests with their start timestamps and
 *   the billing band that start fell in, so the panel can price each request in
 *   the band it actually ran in and show a per-step table after a reload.
 * - `usageBands` keeps a small per-day, per-band, per-model rollup. It stays
 *   cheap enough to travel with every session-list row, makes
 *   cross-conversation cost exact instead of an amount range, and keeps
 *   attribution correct when a conversation switches models.
 *
 * Both are ordinary projection units: the registry drives them from committed
 * events for every live Session whether or not a browser has it open, the
 * projection cache checkpoints them, and re-opening a conversation restores
 * them.
 *
 * @module dsh-usage-insights/host/projection
 */
import { z } from 'zod'
import { bandAt, beijingDay } from '../shared/band.js'

/** Client-visible resolved compaction pressure, or null without a backend. */
const compactionViewSchema = z.object({
  thresholdRatio: z.number().min(0).max(1).nullable(),
}).strict()

/** Token buckets a request carries. */
const bucketsSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
})

/** One billed model request, attributed to its billing band. */
const stepSchema = z.object({
  at: z.number().int().nonnegative(),
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  provider: z.string(),
  model: z.string(),
  /** Billing band of the request start, resolved against configured holidays. */
  band: z.enum(['peak', 'off-peak']),
  ...bucketsSchema.shape,
})

/** A step-start boundary used to stamp the request's real start moment. */
const openSchema = z.object({
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  at: z.number().int().nonnegative(),
}).nullable()

/** The route a request ran on, when the log named one. */
const routeSchema = z.object({
  provider: z.string(),
  model: z.string(),
}).nullable()

/** One model's counters inside one band of one day. */
const bandModelSchema = z.object({
  provider: z.string(),
  model: z.string(),
  requests: z.number().int().nonnegative(),
  ...bucketsSchema.shape,
})

/** Day cell: model-keyed counters per band. */
const dayCellSchema = z.object({
  peak: z.record(z.string(), bandModelSchema),
  offPeak: z.record(z.string(), bandModelSchema),
})

const bandsStateSchema = z.object({
  days: z.record(z.string(), dayCellSchema),
  total: dayCellSchema,
  open: openSchema,
  lastRoute: routeSchema,
})

const stepsStateSchema = z.object({
  steps: z.array(stepSchema),
  omitted: z.number().int().nonnegative(),
  open: openSchema,
  lastRoute: routeSchema,
})

const stepsViewSchema = z.object({
  steps: z.array(stepSchema),
  totalSteps: z.number().int().nonnegative(),
  omittedSteps: z.number().int().nonnegative(),
})

const bandsViewSchema = z.object({
  days: z.array(z.object({
    day: z.string(),
    peak: z.array(bandModelSchema),
    offPeak: z.array(bandModelSchema),
  })),
  total: z.object({
    peak: z.array(bandModelSchema),
    offPeak: z.array(bandModelSchema),
  }),
})

/** Model key of one request; the empty key groups requests the log could not attribute. */
function modelKey(provider, model) {
  return provider.length > 0 && model.length > 0 ? `${provider}/${model}` : ''
}

/** Zeroed counters for one model in one band. */
function zeroModel(provider = '', model = '') {
  return {
    provider,
    model,
    requests: 0,
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  }
}

/** Empty day cell. */
function zeroCell() {
  return { peak: {}, offPeak: {} }
}

/**
 * Empty per-step fold state.
 * @returns zeroed state.
 */
export function emptyStepsState() {
  return { steps: [], omitted: 0, open: null, lastRoute: null }
}

/**
 * Empty per-band rollup state.
 * @returns zeroed state.
 */
export function emptyBandsState() {
  return { days: {}, total: zeroCell(), open: null, lastRoute: null }
}

/**
 * Provider usage reported by one event, if the event billed a request.
 *
 * @param event - committed Session event.
 * @returns the billed facts, or null for an event that reports no usage.
 */
function billedStep(event) {
  if (event.type === 'assistant/message') {
    const usage = event.data.usage
    if (usage === undefined) return null
    const source = event.data.message.source ?? {}
    return {
      turn: event.data.turn,
      step: event.data.step,
      provider: typeof source.provider === 'string' ? source.provider : '',
      model: typeof source.model === 'string' ? source.model : '',
      usage,
    }
  }
  if (event.type === 'assistant/attempt') {
    // A failed or retried attempt commits no message but is still billed; its
    // terminal usage chunk sits in the retained stream.
    const usage = lastUsage(event.data.stream)
    if (usage === undefined) return null
    return { turn: event.data.turn, step: event.data.step, provider: '', model: '', usage }
  }
  return null
}

/**
 * Last usage chunk of a retained assistant stream.
 *
 * @param stream - timestamps plus raw chunks of one attempt.
 * @returns the usage, or undefined when the attempt reported none.
 */
function lastUsage(stream) {
  if (!Array.isArray(stream)) return undefined
  let found
  for (const record of stream) {
    if (record !== null && typeof record === 'object' && record.chunk?.type === 'usage') found = record.chunk.usage
  }
  return found
}

/**
 * Advance the step-start boundary and route memory by one event.
 *
 * @param fold - `{ open, lastRoute }` carried by either unit.
 * @param event - committed Session event.
 * @returns the next boundary state (new object only when it changed).
 */
function advanceFold(fold, event) {
  if (event.type === 'step/start') {
    return { open: { turn: event.data.turn, step: event.data.step, at: event.time }, lastRoute: fold.lastRoute }
  }
  const billed = billedStep(event)
  if (billed === null) return fold
  const open = fold.open
  const route = billed.provider.length > 0 && billed.model.length > 0
    ? { provider: billed.provider, model: billed.model }
    : fold.lastRoute
  const nextOpen = open !== null && open.turn === billed.turn && open.step === billed.step ? null : open
  if (nextOpen === fold.open && route === fold.lastRoute) return fold
  return { open: nextOpen, lastRoute: route }
}

/**
 * Read one non-negative integer.
 *
 * @param value - candidate value.
 * @returns the count, or 0 when absent or malformed.
 */
function count(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

/**
 * Normalize one usage record into counters.
 *
 * @param usage - provider usage record from the log.
 * @returns non-negative integer buckets.
 */
function counters(usage) {
  return {
    uncachedInputTokens: count(usage?.inputTokens),
    cacheReadTokens: count(usage?.cacheReadTokens),
    cacheWriteTokens: count(usage?.cacheWriteTokens),
    outputTokens: count(usage?.outputTokens),
    reasoningTokens: count(usage?.reasoningTokens),
  }
}

/**
 * Build the billed request of one event, stamped with its start time, route and
 * band.
 *
 * @param fold - boundary state before the event.
 * @param event - committed Session event.
 * @param config - resolved band settings.
 * @returns the step to append, or null when the event billed nothing.
 */
function stepOf(fold, event, config) {
  const billed = billedStep(event)
  if (billed === null) return null
  const open = fold.open
  const starts = open !== null && open.turn === billed.turn && open.step === billed.step
  const at = starts ? open.at : event.time
  const route = billed.provider.length > 0 && billed.model.length > 0 ? billed : fold.lastRoute
  return {
    at,
    turn: billed.turn,
    step: billed.step,
    provider: route?.provider ?? '',
    model: route?.model ?? '',
    band: bandAt(at, config.holidays),
    ...counters(billed.usage),
  }
}

/**
 * Fold one event into the per-step unit.
 *
 * @param state - current unit state.
 * @param event - committed Session event.
 * @param config - resolved step limits and holidays.
 * @returns the advanced state (the same reference when nothing changed).
 */
export function foldSteps(state, event, config) {
  const fold = advanceFold({ open: state.open, lastRoute: state.lastRoute }, event)
  const step = stepOf({ open: state.open, lastRoute: state.lastRoute }, event, config)
  if (step === null && fold === state) return state
  if (step === null && fold.open === state.open && fold.lastRoute === state.lastRoute) return state
  const steps = step === null ? state.steps : [...state.steps, step]
  let omitted = state.omitted
  if (steps.length > config.stepHistory) {
    const drop = steps.length - config.stepHistory
    steps.splice(0, drop)
    omitted += drop
  }
  return { steps, omitted, open: fold.open, lastRoute: fold.lastRoute }
}

/**
 * Add one step into one model's counters.
 *
 * @param entry - current counters.
 * @param step - step to add.
 * @returns a new counter object.
 */
function addInto(entry, step) {
  return {
    ...entry,
    requests: entry.requests + 1,
    uncachedInputTokens: entry.uncachedInputTokens + step.uncachedInputTokens,
    cacheReadTokens: entry.cacheReadTokens + step.cacheReadTokens,
    cacheWriteTokens: entry.cacheWriteTokens + step.cacheWriteTokens,
    outputTokens: entry.outputTokens + step.outputTokens,
    reasoningTokens: entry.reasoningTokens + step.reasoningTokens,
  }
}

/**
 * Add one step into a day cell's band map.
 *
 * @param cell - day cell.
 * @param band - `peak` or `offPeak`.
 * @param step - step to add.
 * @returns a new cell.
 */
function addToCell(cell, band, step) {
  const key = modelKey(step.provider, step.model)
  const bucket = cell[band]
  const entry = bucket[key] ?? zeroModel(step.provider, step.model)
  return { ...cell, [band]: { ...bucket, [key]: addInto(entry, step) } }
}

/**
 * Fold one event into the per-band rollup.
 *
 * @param state - current rollup state.
 * @param event - committed Session event.
 * @param config - resolved band limits and holidays.
 * @returns the advanced state.
 */
export function foldBands(state, event, config) {
  const fold = advanceFold({ open: state.open, lastRoute: state.lastRoute }, event)
  const step = stepOf({ open: state.open, lastRoute: state.lastRoute }, event, config)
  if (step === null) {
    if (fold === state) return state
    return { ...state, open: fold.open, lastRoute: fold.lastRoute }
  }
  const day = beijingDay(step.at)
  const band = step.band === 'peak' ? 'peak' : 'offPeak'
  const cell = state.days[day] ?? zeroCell()
  return {
    days: trimDays({ ...state.days, [day]: addToCell(cell, band, step) }, config.bandDays),
    total: addToCell(state.total, band, step),
    open: fold.open,
    lastRoute: fold.lastRoute,
  }
}

/**
 * Keep only the newest `limit` Beijing days.
 *
 * @param days - day map.
 * @param limit - retained days.
 * @returns the trimmed map.
 */
function trimDays(days, limit) {
  const keys = Object.keys(days)
  if (keys.length <= limit) return days
  const kept = keys.sort().slice(keys.length - limit)
  const next = {}
  for (const key of kept) next[key] = days[key]
  return next
}

/**
 * Flatten one band's model map into a stable, sorted array.
 *
 * @param bucket - model-keyed counters.
 * @returns entries sorted by model key.
 */
function flatten(bucket) {
  return Object.keys(bucket).sort().map(key => bucket[key])
}

/**
 * Create the `usageSteps` unit.
 *
 * @param config - resolved step limits and holidays.
 * @returns the projection definition.
 */
export function createUsageStepsProjection(config) {
  return {
    key: 'usageSteps',
    stateVersion: 1,
    stateSchema: stepsStateSchema,
    init: () => emptyStepsState(),
    apply: (state, event) => foldSteps(state, event, config),
    wire: {
      viewSchema: stepsViewSchema,
      view: state => ({
        steps: state.steps.slice(-config.stepWindow),
        totalSteps: state.omitted + state.steps.length,
        omittedSteps: state.omitted + Math.max(0, state.steps.length - config.stepWindow),
      }),
    },
  }
}

/**
 * Create the `usageBands` unit.
 *
 * @param config - resolved band limits and holidays.
 * @returns the projection definition.
 */
export function createUsageBandsProjection(config) {
  return {
    key: 'usageBands',
    stateVersion: 1,
    stateSchema: bandsStateSchema,
    init: () => emptyBandsState(),
    apply: (state, event) => foldBands(state, event, config),
    wire: {
      viewSchema: bandsViewSchema,
      view: state => ({
        days: Object.keys(state.days).sort().map(day => ({
          day,
          peak: flatten(state.days[day].peak),
          offPeak: flatten(state.days[day].offPeak),
        })),
        total: {
          peak: flatten(state.total.peak),
          offPeak: flatten(state.total.offPeak),
        },
      }),
    },
  }
}

/**
 * Create the `usageCompaction` unit.
 *
 * The automatic-compaction pressure ratio is not a session fact: it comes from
 * the backend's resolved configuration, so no event can carry it and replay
 * cannot reproduce an older value. The unit therefore republishes the ratio the
 * Host most recently observed when an Agent was created; a conversation opened
 * before that observation keeps null and simply shows no pressure line.
 *
 * @returns the unit with its update entry point and projection definition.
 */
export function createCompactionThresholdUnit() {
  let thresholdRatio = null
  const state = () => ({ thresholdRatio })
  return {
    /**
     * Record the ratio a compaction backend resolved for a new Agent.
     *
     * @param ratio - resolved threshold ratio, or a value outside (0, 1] to clear it.
     * @returns whether the published value changed.
     */
    set(ratio) {
      const next = typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 && ratio <= 1
        ? ratio
        : null
      if (next === thresholdRatio) return false
      thresholdRatio = next
      return true
    },
    definition: {
      key: 'usageCompaction',
      stateVersion: 1,
      stateSchema: compactionViewSchema,
      init: state,
      apply: current => current.thresholdRatio === thresholdRatio ? current : state(),
      wire: {
        viewSchema: compactionViewSchema,
        view: current => ({ thresholdRatio: current.thresholdRatio }),
      },
    },
  }
}
