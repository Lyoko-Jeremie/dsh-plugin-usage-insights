import { describe, expect, it } from 'vitest'
import type { HistorySessionInput, ModelRef, PricingTable, TokenBuckets } from '../src/client/contract.ts'
import { aggregateHistory, dayKey, RANGE_DAYS } from '../src/lib/aggregate.ts'

const DAY = 86_400_000

/** Zeroed per-agent totals for expectations. */
function zeroAgentTotals() {
  return {
    sessions: 0,
    measured: 0,
    totalTokens: 0,
    cacheRate: null,
    cost: null,
    costBasis: 'none' as const,
  }
}

/** Epoch milliseconds of a local calendar date, noon by default. */
function localDay(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime()
}

/** Token buckets with every unspecified bucket left at zero. */
function tokens(partial: Partial<TokenBuckets> = {}): TokenBuckets {
  return {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...partial,
  }
}

const priced: PricingTable = {
  currency: 'USD',
  prices: [{ provider: 'alpha', model: 'chat', input: 1, cacheRead: 2, cacheWrite: 3, output: 4 }],
}

const pricedWithFallback: PricingTable = {
  ...priced,
  prices: [],
  fallback: { input: 1, cacheRead: 1, cacheWrite: 1, output: 1 },
}

/** Build one history row, omitting the usage field when the row is unmeasured. */
function session(
  id: string,
  updatedAt: number,
  options: {
    tokenUsage?: TokenBuckets
    model?: ModelRef | null
    bands?: HistorySessionInput['bands']
    kind?: HistorySessionInput['kind']
  } = {},
): HistorySessionInput {
  const tokenUsage = options.tokenUsage
  return {
    id,
    updatedAt,
    model: options.model ?? null,
    ...(tokenUsage === undefined ? {} : { tokenUsage }),
    ...(options.bands === undefined ? {} : { bands: options.bands }),
    ...(options.kind === undefined ? {} : { kind: options.kind }),
  }
}

const emptyBuckets = tokens()

describe('RANGE_DAYS', () => {
  it('maps the bounded ranges to their day counts', () => {
    expect(RANGE_DAYS).toEqual({ '7d': 7, '30d': 30 })
    expect(RANGE_DAYS['7d']).toBe(7)
    expect(RANGE_DAYS['30d']).toBe(30)
  })
})

describe('dayKey', () => {
  it('formats the local calendar day as YYYY-MM-DD', () => {
    expect(dayKey(localDay(2024, 5, 10))).toBe('2024-05-10')
    expect(dayKey(localDay(2024, 1, 5, 0, 0))).toBe('2024-01-05')
  })

  it('keeps the local day on both sides of local midnight', () => {
    expect(dayKey(localDay(2024, 5, 10, 23, 59))).toBe('2024-05-10')
    expect(dayKey(localDay(2024, 5, 11, 0, 0))).toBe('2024-05-11')
  })

  it('ignores the UTC day when the host is ahead of UTC', () => {
    // Local midnight falls on the previous UTC day for positive offsets.
    const time = localDay(2024, 5, 10, 0, 30)
    const date = new Date(time)
    expect(dayKey(time)).toBe('2024-05-10')
    if (date.getTimezoneOffset() < 0) {
      expect(date.getUTCDate()).toBe(9)
    }
  })
})

describe('aggregateHistory', () => {
  it('aggregates an empty session list', () => {
    const view = aggregateHistory({ sessions: [], range: 'all', now: localDay(2024, 6, 15), pricing: priced })
    expect(view).toEqual({
      range: 'all',
      sessionCount: 0,
      measuredCount: 0,
      missingCount: 0,
      fallbackCount: 0,
      buckets: emptyBuckets,
      totalTokens: 0,
      cacheRate: null,
      activeDays: 0,
      days: [],
      cost: null,
      costBasis: 'none',
      agents: {
        root: zeroAgentTotals(),
        subagent: zeroAgentTotals(),
      },
      bandShare: null,
      bandSharePartial: false,
    })
  })

  it('counts sessions without usage as missing and derives no day', () => {
    const now = localDay(2024, 6, 15)
    const view = aggregateHistory({
      sessions: [session('a', now), session('b', now)],
      range: 'all',
      now,
      pricing: priced,
    })
    expect(view.sessionCount).toBe(2)
    expect(view.measuredCount).toBe(0)
    expect(view.missingCount).toBe(2)
    expect(view.buckets).toEqual(emptyBuckets)
    expect(view.totalTokens).toBe(0)
    expect(view.activeDays).toBe(0)
    expect(view.days).toEqual([])
    expect(view.cost).toBeNull()
  })

  it('filters sessions by the selected range', () => {
    const now = localDay(2024, 6, 15)
    const sessions = [
      session('today', now, { tokenUsage: tokens({ uncachedInputTokens: 100 }) }),
      session('yesterday', now - DAY, { tokenUsage: tokens({ uncachedInputTokens: 100 }) }),
      session('weekAgo', now - 8 * DAY, { tokenUsage: tokens({ uncachedInputTokens: 100 }) }),
      session('monthAgo', now - 31 * DAY, { tokenUsage: tokens({ uncachedInputTokens: 100 }) }),
    ]
    expect(aggregateHistory({ sessions, range: '7d', now, pricing: priced }).sessionCount).toBe(2)
    expect(aggregateHistory({ sessions, range: '30d', now, pricing: priced }).sessionCount).toBe(3)
    expect(aggregateHistory({ sessions, range: 'all', now, pricing: priced }).sessionCount).toBe(4)

    expect(aggregateHistory({ sessions, range: '7d', now, pricing: priced }).totalTokens).toBe(200)
    expect(aggregateHistory({ sessions, range: '30d', now, pricing: priced }).totalTokens).toBe(300)
    expect(aggregateHistory({ sessions, range: 'all', now, pricing: priced }).totalTokens).toBe(400)
  })

  it('includes a session exactly on the range cutoff', () => {
    const now = localDay(2024, 6, 15)
    const sessions = [
      session('onCutoff', now - 7 * DAY, { tokenUsage: tokens({ outputTokens: 1 }) }),
      session('pastCutoff', now - 7 * DAY - 1, { tokenUsage: tokens({ outputTokens: 1 }) }),
    ]
    const view = aggregateHistory({ sessions, range: '7d', now, pricing: priced })
    expect(view.sessionCount).toBe(1)
    expect(view.totalTokens).toBe(1)
  })

  it('groups measured sessions by local day in ascending order', () => {
    const now = localDay(2024, 6, 1)
    const sessions = [
      session('may10a', localDay(2024, 5, 10), {
        tokenUsage: tokens({
          uncachedInputTokens: 100,
          outputTokens: 10,
          cacheReadTokens: 5,
          cacheWriteTokens: 1,
        }),
      }),
      session('may10b', localDay(2024, 5, 10), {
        tokenUsage: tokens({
          uncachedInputTokens: 200,
          outputTokens: 20,
          cacheReadTokens: 10,
          cacheWriteTokens: 2,
        }),
      }),
      session('may9', localDay(2024, 5, 9), {
        tokenUsage: tokens({ uncachedInputTokens: 7, outputTokens: 3 }),
      }),
    ]
    const view = aggregateHistory({ sessions, range: 'all', now, pricing: priced })
    expect(view.days).toEqual([
      {
        day: '2024-05-09',
        totalTokens: 10,
        inputTokens: 7,
        outputTokens: 3,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        sessions: 1,
      },
      {
        day: '2024-05-10',
        totalTokens: 348,
        inputTokens: 300,
        outputTokens: 30,
        cacheReadTokens: 15,
        cacheWriteTokens: 3,
        sessions: 2,
      },
    ])
    expect(view.totalTokens).toBe(358)
    expect(view.activeDays).toBe(2)
  })

  it('keeps days apart across a month boundary', () => {
    const now = localDay(2024, 3, 1)
    const sessions = [
      session('jan', localDay(2024, 1, 31), { tokenUsage: tokens({ outputTokens: 1 }) }),
      session('feb', localDay(2024, 2, 1), { tokenUsage: tokens({ outputTokens: 2 }) }),
    ]
    const view = aggregateHistory({ sessions, range: 'all', now, pricing: priced })
    expect(view.days.map((day) => day.day)).toEqual(['2024-01-31', '2024-02-01'])
    expect(view.days.map((day) => day.totalTokens)).toEqual([1, 2])
  })

  it('does not create a day for an unmeasured session', () => {
    const now = localDay(2024, 6, 1)
    const sessions = [
      session('measured', localDay(2024, 5, 10), { tokenUsage: tokens({ outputTokens: 9 }) }),
      session('missing', localDay(2024, 5, 12)),
    ]
    const view = aggregateHistory({ sessions, range: 'all', now, pricing: priced })
    expect(view.days.map((day) => day.day)).toEqual(['2024-05-10'])
    expect(view.sessionCount).toBe(2)
    expect(view.measuredCount).toBe(1)
    expect(view.missingCount).toBe(1)
  })

  it('derives the cache rate from every measured session', () => {
    const now = localDay(2024, 6, 1)
    const sessions = [
      session('a', now, {
        tokenUsage: tokens({ uncachedInputTokens: 100, outputTokens: 100, cacheReadTokens: 200 }),
      }),
      session('b', now, { tokenUsage: tokens({ uncachedInputTokens: 100, cacheReadTokens: 100 }) }),
    ]
    const view = aggregateHistory({ sessions, range: 'all', now, pricing: priced })
    // cacheRead 300 over billed input 500.
    expect(view.cacheRate).toBeCloseTo(0.6, 6)
    expect(view.totalTokens).toBe(600)
  })

  it('sums the cost of fully priced sessions', () => {
    const now = localDay(2024, 6, 1)
    const usage = tokens({ uncachedInputTokens: 1_000_000, outputTokens: 1_000_000 })
    const sessions = [
      session('a', now, { tokenUsage: usage, model: { provider: 'alpha', model: 'chat' } }),
      session('b', now - DAY, { tokenUsage: usage, model: { provider: 'alpha', model: 'chat' } }),
    ]
    const view = aggregateHistory({ sessions, range: 'all', now, pricing: priced })
    expect(view.totalTokens).toBe(4_000_000)
    expect(view.cost).toEqual({
      amountMicros: 10_000_000,
      currency: 'USD',
      pricedTokens: 4_000_000,
      totalTokens: 4_000_000,
      complete: true,
    })
  })

  it('marks the cost incomplete when a measured session is unpriced', () => {
    const now = localDay(2024, 6, 1)
    const usage = tokens({ uncachedInputTokens: 1_000_000, outputTokens: 1_000_000 })
    const sessions = [
      session('a', now, { tokenUsage: usage, model: { provider: 'alpha', model: 'chat' } }),
      session('b', now, { tokenUsage: usage, model: { provider: 'alpha', model: 'chat' } }),
      session('unpriced', now, {
        tokenUsage: tokens({ uncachedInputTokens: 1_000_000 }),
        model: { provider: 'alpha', model: 'other' },
      }),
    ]
    const view = aggregateHistory({ sessions, range: 'all', now, pricing: priced })
    // Tokens count every measured session, priced or not.
    expect(view.totalTokens).toBe(5_000_000)
    expect(view.cost).toEqual({
      amountMicros: 10_000_000,
      currency: 'USD',
      pricedTokens: 4_000_000,
      totalTokens: 4_000_000,
      complete: false,
    })
  })

  it('returns a null cost when no measured session has a price', () => {
    const now = localDay(2024, 6, 1)
    const sessions = [
      session('a', now, {
        tokenUsage: tokens({ outputTokens: 1_000 }),
        model: { provider: 'alpha', model: 'unknown' },
      }),
    ]
    const view = aggregateHistory({ sessions, range: 'all', now, pricing: priced })
    expect(view.totalTokens).toBe(1_000)
    expect(view.cost).toBeNull()
  })

  it('prices a route known only by fallback', () => {
    const now = localDay(2024, 6, 1)
    const sessions = [
      session('a', now, { tokenUsage: tokens({ uncachedInputTokens: 1_000_000 }), model: null }),
    ]
    const view = aggregateHistory({
      sessions,
      range: 'all',
      now,
      pricing: pricedWithFallback,
    })
    expect(view.cost).toEqual({
      amountMicros: 1_000_000,
      currency: 'USD',
      pricedTokens: 1_000_000,
      totalTokens: 1_000_000,
      complete: true,
    })
  })

  it('splits root conversations from delegated subagents', () => {
    const now = localDay(2024, 6, 1)
    const sessions = [
      session('root', now, {
        tokenUsage: tokens({ uncachedInputTokens: 1_000_000 }),
        model: { provider: 'alpha', model: 'chat' },
      }),
      session('sub', now, {
        tokenUsage: tokens({ outputTokens: 1_000_000 }),
        model: { provider: 'alpha', model: 'chat' },
        kind: 'subagent',
      }),
      session('sub-empty', now, { kind: 'subagent' }),
    ]
    const view = aggregateHistory({ sessions, range: 'all', now, pricing: priced })
    expect(view.agents.root).toMatchObject({
      sessions: 1, measured: 1, totalTokens: 1_000_000, costBasis: 'range',
    })
    expect(view.agents.subagent).toMatchObject({
      sessions: 2, measured: 1, totalTokens: 1_000_000, costBasis: 'range',
    })
    // The aggregate totals still count both kinds.
    expect(view.totalTokens).toBe(2_000_000)
    expect(view.sessionCount).toBe(3)
    expect(view.agents.root.cost?.amountMicros).toBe(1_000_000)
    expect(view.agents.subagent.cost?.amountMicros).toBe(4_000_000)
  })

  it('reports the exact basis per kind when only one kind has band rollups', () => {
    const now = localDay(2024, 6, 1)
    const bands = {
      days: [],
      total: {
        peak: [{
          provider: 'alpha', model: 'chat', requests: 1,
          uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0,
          outputTokens: 0, reasoningTokens: 0,
        }],
        offPeak: [],
      },
    }
    const sessions = [
      session('root', now, { bands: bands as never, model: { provider: 'alpha', model: 'chat' } }),
      session('sub', now, {
        tokenUsage: tokens({ outputTokens: 1_000_000 }),
        model: { provider: 'alpha', model: 'chat' },
        kind: 'subagent',
      }),
    ]
    const view = aggregateHistory({ sessions, range: 'all', now, pricing: priced })
    expect(view.costBasis).toBe('range')
    expect(view.agents.root.costBasis).toBe('bands')
    expect(view.agents.subagent.costBasis).toBe('range')
  })
})
