import { describe, expect, it } from 'vitest'
import {
  createCompactionThresholdUnit,
  createUsageBandsProjection,
  createUsageStepsProjection,
  emptyBandsState,
  emptyStepsState,
  foldBands,
  foldSteps,
} from '../src/host/projection.js'

/** Beijing wall-clock instant as epoch milliseconds. */
function beijing(year, month, day, hour, minute = 0) {
  return Date.UTC(year, month - 1, day, hour - 8, minute)
}

/** Provider usage for one request. */
function usage(partial = {}) {
  return {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 1000,
    cacheWriteTokens: 0,
    reasoningTokens: 10,
    ...partial,
  }
}

/** A `step/start` event. */
function started(time, turn, step) {
  return { type: 'step/start', time, data: { turn, step } }
}

/** A committed assistant message carrying usage. */
function message(time, turn, step, reported = usage(), route = { provider: 'deepseek', model: 'deepseek-flash' }) {
  return {
    type: 'assistant/message',
    time,
    data: { turn, step, message: { source: route }, stream: [], usage: reported },
  }
}

/** A failed attempt that committed no message but was billed. */
function attempt(time, turn, step, reported = usage()) {
  return {
    type: 'assistant/attempt',
    time,
    data: { turn, step, stream: [{ time, chunk: { type: 'usage', usage: reported } }] },
  }
}

/** Fold a sequence into the per-step unit. */
function foldAll(events, config = { stepHistory: 200, stepWindow: 20 }) {
  let state = emptyStepsState()
  for (const event of events) state = foldSteps(state, event, config)
  return state
}

/** Fold a sequence into the per-band unit. */
function foldBandsAll(events, config = { bandDays: 90, holidays: [] }) {
  let state = emptyBandsState()
  for (const event of events) state = foldBands(state, event, config)
  return state
}

describe('usageSteps fold', () => {
  it('stamps the step with its start time and the week day band', () => {
    const state = foldAll([
      started(beijing(2026, 10, 21, 10, 0), 1, 0),
      message(beijing(2026, 10, 21, 10, 2), 1, 0),
    ])
    expect(state.steps).toHaveLength(1)
    expect(state.steps[0]).toMatchObject({
      at: beijing(2026, 10, 21, 10, 0),
      turn: 1,
      step: 0,
      provider: 'deepseek',
      model: 'deepseek-flash',
      band: 'peak',
      uncachedInputTokens: 100,
      cacheReadTokens: 1000,
      outputTokens: 50,
      reasoningTokens: 10,
    })
  })

  it('counts a failed attempt and keeps the route of the previous message', () => {
    const state = foldAll([
      started(beijing(2026, 10, 21, 20, 0), 2, 0),
      attempt(beijing(2026, 10, 21, 20, 1), 2, 0, usage({ inputTokens: 7 })),
    ])
    expect(state.steps).toHaveLength(1)
    expect(state.steps[0]).toMatchObject({ band: 'off-peak', uncachedInputTokens: 7, provider: '', model: '' })
  })

  it('bounds the retained history and counts what it dropped', () => {
    const config = { stepHistory: 2, stepWindow: 20 }
    const state = foldAll([
      started(beijing(2026, 10, 21, 10, 0), 1, 0), message(beijing(2026, 10, 21, 10, 1), 1, 0),
      started(beijing(2026, 10, 21, 10, 2), 2, 0), message(beijing(2026, 10, 21, 10, 3), 2, 0),
      started(beijing(2026, 10, 21, 10, 4), 3, 0), message(beijing(2026, 10, 21, 10, 5), 3, 0),
    ], config)
    expect(state.steps.map(step => step.turn)).toEqual([2, 3])
    expect(state.omitted).toBe(1)
  })

  it('ignores events that bill nothing', () => {
    const state = foldAll([{ type: 'user/message', time: 1, data: { turn: 1 } }])
    expect(state).toEqual(emptyStepsState())
  })

  it('exposes a bounded window plus total and omitted counts', () => {
    const definition = createUsageStepsProjection({ stepHistory: 5, stepWindow: 2 })
    let state = definition.init()
    for (let index = 1; index <= 4; index += 1) {
      state = definition.apply(state, started(beijing(2026, 10, 21, 10, index), index, 0))
      state = definition.apply(state, message(beijing(2026, 10, 21, 10, index), index, 0))
    }
    const view = definition.wire.view(state)
    expect(view.totalSteps).toBe(4)
    expect(view.steps.map(step => step.turn)).toEqual([3, 4])
    expect(view.omittedSteps).toBe(2)
    expect(definition.wire.viewSchema.parse(view)).toEqual(view)
  })
})

describe('usageCompaction unit', () => {
  it('starts without a threshold and publishes the observed ratio', () => {
    const unit = createCompactionThresholdUnit()
    const definition = unit.definition
    expect(definition.wire.view(definition.init())).toEqual({ thresholdRatio: null })

    expect(unit.set(0.5)).toBe(true)
    expect(definition.wire.view(definition.init())).toEqual({ thresholdRatio: 0.5 })

    // Replaying an event republishes the latest observed ratio.
    const state = definition.apply(definition.init(), started(1, 1, 0))
    expect(definition.wire.view(state)).toEqual({ thresholdRatio: 0.5 })
    expect(definition.wire.viewSchema.parse(definition.wire.view(state))).toEqual({ thresholdRatio: 0.5 })
  })

  it('ignores an unchanged or invalid ratio', () => {
    const unit = createCompactionThresholdUnit()
    expect(unit.set(0.8)).toBe(true)
    expect(unit.set(0.8)).toBe(false)
    expect(unit.set(0)).toBe(true)
    expect(unit.definition.wire.view(unit.definition.init())).toEqual({ thresholdRatio: null })
    expect(unit.set(2)).toBe(false)
  })
})

describe('usageBands fold', () => {
  it('splits a day by band and keeps totals', () => {
    const state = foldBandsAll([
      started(beijing(2026, 10, 21, 10, 0), 1, 0), message(beijing(2026, 10, 21, 10, 1), 1, 0),
      started(beijing(2026, 10, 21, 20, 0), 2, 0), message(beijing(2026, 10, 21, 20, 1), 2, 0),
      started(beijing(2026, 10, 21, 10, 2), 3, 0), message(beijing(2026, 10, 21, 10, 3), 3, 0),
    ])
    const key = 'deepseek/deepseek-flash'
    expect(state.total.peak[key].requests).toBe(2)
    expect(state.total.offPeak[key].requests).toBe(1)
    expect(state.days['2026-10-21'].peak[key].requests).toBe(2)
    expect(state.days['2026-10-21'].offPeak[key].requests).toBe(1)
    expect(state.total.peak[key].cacheReadTokens).toBe(2000)
  })

  it('bills a configured holiday off-peak', () => {
    const config = { bandDays: 90, holidays: ['2026-10-21'] }
    const state = foldBandsAll([
      started(beijing(2026, 10, 21, 10, 0), 1, 0), message(beijing(2026, 10, 21, 10, 1), 1, 0),
    ], config)
    expect(Object.keys(state.total.peak)).toHaveLength(0)
    expect(state.total.offPeak['deepseek/deepseek-flash'].requests).toBe(1)
  })

  it('keeps only the newest days and emits a sorted view', () => {
    const definition = createUsageBandsProjection({ bandDays: 2, holidays: [] })
    let state = definition.init()
    for (const day of [19, 20, 21]) {
      state = definition.apply(state, started(beijing(2026, 10, day, 10, 0), 1, 0))
      state = definition.apply(state, message(beijing(2026, 10, day, 10, 1), 1, 0))
    }
    const view = definition.wire.view(state)
    expect(view.days.map(entry => entry.day)).toEqual(['2026-10-20', '2026-10-21'])
    expect(view.total.peak[0].requests).toBe(3)
    expect(view.total.peak[0]).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash' })
    expect(definition.wire.viewSchema.parse(view)).toEqual(view)
  })
})
