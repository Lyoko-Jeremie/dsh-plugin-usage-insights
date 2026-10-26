import { describe, expect, it } from 'vitest'
import type { HistorySessionInput, ModelRef, PricingTable, TokenBuckets, UsageStepView } from '../src/client/contract.ts'
import { aggregateHistory, dayKey, RANGE_DAYS, rangeCutoff } from '../src/lib/aggregate.ts'

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
    steps?: HistorySessionInput['steps']
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
    ...(options.steps === undefined ? {} : { steps: options.steps }),
    ...(options.kind === undefined ? {} : { kind: options.kind }),
  }
}

/** One billed request with its start time and billing band. */
function step(
  at: number,
  partial: Partial<TokenBuckets> = {},
  band: 'peak' | 'off-peak' = 'peak',
): UsageStepView {
  const buckets = tokens(partial)
  return {
    at,
    turn: 1,
    step: 0,
    provider: 'alpha',
    model: 'chat',
    band,
    uncachedInputTokens: buckets.uncachedInputTokens,
    cacheReadTokens: buckets.cacheReadTokens,
    cacheWriteTokens: buckets.cacheWriteTokens,
    outputTokens: buckets.outputTokens,
    reasoningTokens: 0,
  }
}

/** One complete step window holding every request of a conversation. */
function windowOf(...steps: UsageStepView[]): NonNullable<HistorySessionInput['steps']> {
  return { steps, totalSteps: steps.length, omittedSteps: 0 }
}

const emptyBuckets = tokens()

describe('RANGE_DAYS', () => {
  it('maps the bounded ranges to their day counts', () => {
    expect(RANGE_DAYS).toEqual({ '7d': 7, '30d': 30 })
    expect(RANGE_DAYS['7d']).toBe(7)
    expect(RANGE_DAYS['30d']).toBe(30)
  })
})

describe('rangeCutoff', () => {
  // 2024-06-15 10:00 Beijing time.
  const now = Date.UTC(2024, 5, 15, 2, 0)

  it('starts the rolling window a day back', () => {
    expect(rangeCutoff('24h', now)).toBe(now - 86_400_000)
  })

  it('starts today at the Beijing midnight', () => {
    // 2024-06-15 00:00 Beijing time is 2024-06-14 16:00 UTC.
    expect(rangeCutoff('today', now)).toBe(Date.UTC(2024, 5, 14, 16, 0))
  })

  it('derives the day-count and unbounded ranges', () => {
    expect(rangeCutoff('7d', now)).toBe(now - 7 * 86_400_000)
    expect(rangeCutoff('30d', now)).toBe(now - 30 * 86_400_000)
    expect(rangeCutoff('all', now)).toBeNull()
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
      sessions: [],
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

  it('filters the rolling 24-hour window', () => {
    const now = localDay(2024, 6, 15)
    const sessions = [
      session('recent', now - 3_600_000, { tokenUsage: tokens({ outputTokens: 10 }) }),
      session('old', now - 26 * 3_600_000, { tokenUsage: tokens({ outputTokens: 20 }) }),
    ]
    const view = aggregateHistory({ sessions, range: '24h', now, pricing: priced })
    expect(view.sessionCount).toBe(1)
    expect(view.sessions.map(row => row.id)).toEqual(['recent'])
    expect(view.totalTokens).toBe(10)
  })

  it('filters to the current Beijing day', () => {
    const now = localDay(2024, 6, 15, 10, 0)
    const midnight = rangeCutoff('today', now) ?? now
    const sessions = [
      session('today', midnight + 3_600_000, { tokenUsage: tokens({ outputTokens: 10 }) }),
      session('yesterday', midnight - 3_600_000, { tokenUsage: tokens({ outputTokens: 20 }) }),
    ]
    const view = aggregateHistory({ sessions, range: 'today', now, pricing: priced })
    expect(view.sessionCount).toBe(1)
    expect(view.sessions.map(row => row.id)).toEqual(['today'])
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
        peakTokens: 0,
        offPeakTokens: 0,
        unattributedTokens: 10,
        costMicros: null,
        peakCostMicros: 0,
        offPeakCostMicros: 0,
        otherCostMicros: 0,
        costUnpriced: true,
      },
      {
        day: '2024-05-10',
        totalTokens: 348,
        inputTokens: 300,
        outputTokens: 30,
        cacheReadTokens: 15,
        cacheWriteTokens: 3,
        sessions: 2,
        peakTokens: 0,
        offPeakTokens: 0,
        unattributedTokens: 348,
        costMicros: null,
        peakCostMicros: 0,
        offPeakCostMicros: 0,
        otherCostMicros: 0,
        costUnpriced: true,
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

  it('reports one row per measured conversation, largest first', () => {
    const now = localDay(2024, 6, 1)
    const view = aggregateHistory({
      sessions: [
        session('small', now, {
          tokenUsage: tokens({ outputTokens: 10 }),
          model: { provider: 'alpha', model: 'chat' },
        }),
        session('large', now - DAY, {
          tokenUsage: tokens({ uncachedInputTokens: 1_000_000 }),
          model: { provider: 'alpha', model: 'chat' },
        }),
        session('empty', now),
      ],
      range: 'all',
      now,
      pricing: priced,
    })
    // The unmeasured conversation gets no row; the rest are ordered by tokens.
    expect(view.sessions.map(row => row.id)).toEqual(['large', 'small'])
    expect(view.sessions[0]).toMatchObject({
      title: 'large',
      kind: 'root',
      totalTokens: 1_000_000,
      cacheRate: 0,
      costBasis: 'range',
    })
    expect(view.sessions[1]?.totalTokens).toBe(10)
    expect(view.sessions[1]?.cost?.amountMicros).toBe(40)
    expect(view.sessions[0]?.cost?.amountMicros).toBe(1_000_000)
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

describe('aggregateHistory request timing', () => {
  const route = { provider: 'alpha', model: 'chat' }

  /** Peak input costs 10 per million, off-peak 5; output costs nothing. */
  const bandPricing: PricingTable = {
    currency: 'USD',
    prices: [{
      provider: 'alpha',
      model: 'chat',
      input: 10,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      offPeak: { input: 5, cacheRead: 0, cacheWrite: 0, output: 0 },
    }],
  }

  it('counts each request in the day it ran, not the day the conversation was touched', () => {
    const now = localDay(2024, 6, 15, 12, 0)
    const sessions = [
      session('spans', now, {
        model: route,
        steps: windowOf(
          step(localDay(2024, 6, 10, 9, 0), { uncachedInputTokens: 100 }, 'peak'),
          step(localDay(2024, 6, 15, 9, 0), { uncachedInputTokens: 50 }, 'off-peak'),
        ),
      }),
    ]
    const view = aggregateHistory({ sessions, range: '7d', now, pricing: priced })
    expect(view.sessionCount).toBe(1)
    expect(view.totalTokens).toBe(150)
    expect(view.days.map(day => [day.day, day.totalTokens])).toEqual([
      ['2024-06-10', 100],
      ['2024-06-15', 50],
    ])
    expect(view.days[0]?.peakTokens).toBe(100)
    expect(view.days[1]?.offPeakTokens).toBe(50)
    expect(view.sessions[0]?.totalTokens).toBe(150)
    expect(view.sessions[0]?.costBasis).toBe('bands')
  })

  it('keeps yesterday out of the current-day figures of a conversation that spans days', () => {
    const now = localDay(2024, 6, 15, 12, 0)
    const sessions = [
      session('spans', now, {
        model: route,
        steps: windowOf(
          step(localDay(2024, 6, 14, 20, 0), { outputTokens: 10 }, 'off-peak'),
          step(localDay(2024, 6, 15, 9, 0), { outputTokens: 20 }, 'peak'),
        ),
      }),
    ]
    const view = aggregateHistory({ sessions, range: 'today', now, pricing: priced })
    expect(view.sessionCount).toBe(1)
    expect(view.totalTokens).toBe(20)
    expect(view.days).toHaveLength(1)
    expect(view.days[0]?.day).toBe('2024-06-15')
    expect(view.bandShare).toEqual({
      peakTokens: 20, offPeakTokens: 0, peakRequests: 1, offPeakRequests: 0,
    })
  })

  it('filters a rolling 24-hour window down to the request start', () => {
    const now = localDay(2024, 6, 15, 12, 0)
    const sessions = [
      session('recent', now, {
        model: route,
        steps: windowOf(
          step(now - 2 * 3_600_000, { outputTokens: 10 }),
          step(now - 25 * 3_600_000, { outputTokens: 40 }),
        ),
      }),
    ]
    const view = aggregateHistory({ sessions, range: '24h', now, pricing: priced })
    expect(view.totalTokens).toBe(10)
    expect(view.sessionCount).toBe(1)
    expect(view.days.map(day => day.totalTokens)).toEqual([10])
  })

  it('prices every request in the band it actually ran in', () => {
    const now = localDay(2024, 6, 15, 12, 0)
    const sessions = [
      session('spans', now, {
        model: route,
        steps: windowOf(
          step(localDay(2024, 6, 15, 9, 0), { uncachedInputTokens: 1_000_000 }, 'peak'),
          step(localDay(2024, 6, 15, 21, 0), { uncachedInputTokens: 1_000_000 }, 'off-peak'),
        ),
      }),
    ]
    const view = aggregateHistory({ sessions, range: 'today', now, pricing: bandPricing })
    expect(view.cost).toEqual({
      amountMicros: 15_000_000,
      currency: 'USD',
      pricedTokens: 2_000_000,
      totalTokens: 2_000_000,
      complete: true,
    })
    expect(view.costBasis).toBe('bands')
  })

  it('falls back to the day rollup when the step window is incomplete', () => {
    const now = localDay(2024, 6, 15, 12, 0)
    const entry = {
      provider: 'alpha', model: 'chat', requests: 1,
      uncachedInputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0,
      outputTokens: 0, reasoningTokens: 0,
    }
    const sessions = [
      session('spans', now, {
        model: route,
        bands: {
          days: [
            { day: '2024-06-10', peak: [entry], offPeak: [] },
            { day: '2024-06-15', peak: [], offPeak: [entry] },
          ],
          total: { peak: [entry], offPeak: [entry] },
        },
        steps: {
          steps: [step(localDay(2024, 6, 15, 9, 0), { uncachedInputTokens: 300 }, 'off-peak')],
          totalSteps: 3,
          omittedSteps: 2,
        },
      }),
    ]
    const view = aggregateHistory({ sessions, range: '7d', now, pricing: priced })
    // The rollup covers the whole conversation, the truncated window does not.
    expect(view.totalTokens).toBe(600)
    expect(view.days.map(day => [day.day, day.totalTokens])).toEqual([
      ['2024-06-10', 300],
      ['2024-06-15', 300],
    ])
  })

  it('counts only the rollup days a bounded range includes', () => {
    const now = localDay(2024, 6, 15, 12, 0)
    const entry = (tokensPerRequest: number) => ({
      provider: 'alpha', model: 'chat', requests: 1,
      uncachedInputTokens: tokensPerRequest, cacheReadTokens: 0, cacheWriteTokens: 0,
      outputTokens: 0, reasoningTokens: 0,
    })
    const sessions = [
      session('spans', now, {
        model: route,
        bands: {
          days: [
            { day: '2024-06-01', peak: [entry(999)], offPeak: [] },
            { day: '2024-06-10', peak: [entry(100)], offPeak: [] },
          ],
          total: { peak: [entry(999), entry(100)], offPeak: [] },
        },
      }),
    ]
    const view = aggregateHistory({ sessions, range: '7d', now, pricing: priced })
    expect(view.totalTokens).toBe(100)
    expect(view.days.map(day => day.day)).toEqual(['2024-06-10'])
    expect(view.sessions[0]?.totalTokens).toBe(100)
  })

  it('drops conversations whose requests all fall outside the range', () => {
    const now = localDay(2024, 6, 15, 12, 0)
    const sessions = [
      session('old', now, {
        model: route,
        steps: windowOf(step(localDay(2024, 5, 1, 9, 0), { outputTokens: 40 })),
      }),
    ]
    const view = aggregateHistory({ sessions, range: '7d', now, pricing: priced })
    expect(view.sessionCount).toBe(0)
    expect(view.totalTokens).toBe(0)
    expect(view.sessions).toEqual([])
  })
})

describe('aggregateHistory daily cost', () => {
  const route = { provider: 'alpha', model: 'chat' }

  /** Peak input costs 10 per million, off-peak 5; every other bucket is free. */
  const bandPricing: PricingTable = {
    currency: 'USD',
    prices: [{
      provider: 'alpha',
      model: 'chat',
      input: 10,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      offPeak: { input: 5, cacheRead: 0, cacheWrite: 0, output: 0 },
    }],
  }

  /** One model entry for a day rollup. */
  function entry(uncachedInputTokens: number) {
    return {
      provider: 'alpha', model: 'chat', requests: 1,
      uncachedInputTokens, cacheReadTokens: 0, cacheWriteTokens: 0,
      outputTokens: 0, reasoningTokens: 0,
    }
  }

  it('prices each day in the band its own requests ran in', () => {
    const now = localDay(2024, 6, 15, 12, 0)
    const sessions = [
      session('spans', now, {
        model: route,
        steps: windowOf(
          step(localDay(2024, 6, 10, 9, 0), { uncachedInputTokens: 1_000_000 }, 'peak'),
          step(localDay(2024, 6, 15, 21, 0), { uncachedInputTokens: 2_000_000 }, 'off-peak'),
        ),
      }),
    ]
    const view = aggregateHistory({ sessions, range: '7d', now, pricing: bandPricing })
    expect(view.days.map(day => [
      day.day, day.costMicros, day.peakCostMicros, day.offPeakCostMicros, day.otherCostMicros,
    ])).toEqual([
      ['2024-06-10', 10_000_000, 10_000_000, 0, 0],
      ['2024-06-15', 10_000_000, 0, 10_000_000, 0],
    ])
    expect(view.days[0]?.costMicrosMax).toBeUndefined()
    expect(view.days[0]?.costUnpriced).toBe(false)
  })

  it('prices the rollup days a bounded range includes', () => {
    const now = localDay(2024, 6, 15, 12, 0)
    const sessions = [
      session('spans', now, {
        model: route,
        bands: {
          days: [
            { day: '2024-06-01', peak: [entry(999)], offPeak: [] },
            { day: '2024-06-10', peak: [entry(1_000_000)], offPeak: [] },
            { day: '2024-06-15', peak: [], offPeak: [entry(2_000_000)] },
          ],
          total: { peak: [entry(999), entry(1_000_000)], offPeak: [entry(2_000_000)] },
        },
      }),
    ]
    const view = aggregateHistory({ sessions, range: '7d', now, pricing: bandPricing })
    expect(view.days.map(day => [day.day, day.costMicros])).toEqual([
      ['2024-06-10', 10_000_000],
      ['2024-06-15', 10_000_000],
    ])
  })

  it('keeps a fallback day as an amount range outside the band split', () => {
    const now = localDay(2024, 6, 15, 12, 0)
    const sessions = [
      session('fallback', now, { model: route, tokenUsage: tokens({ uncachedInputTokens: 1_000_000 }) }),
    ]
    const view = aggregateHistory({ sessions, range: '7d', now, pricing: bandPricing })
    const day = view.days[0]
    expect(day?.costMicros).toBe(5_000_000)
    expect(day?.costMicrosMax).toBe(10_000_000)
    expect(day?.peakCostMicros).toBe(0)
    expect(day?.offPeakCostMicros).toBe(0)
    expect(day?.otherCostMicros).toBe(5_000_000)
    expect(day?.costUnpriced).toBe(false)
  })

  it('adds a per-band day and a range-estimated day into one amount', () => {
    const now = localDay(2024, 6, 15, 12, 0)
    const sessions = [
      session('bands', now, {
        model: route,
        bands: {
          days: [{ day: '2024-06-15', peak: [entry(1_000_000)], offPeak: [] }],
          total: { peak: [entry(1_000_000)], offPeak: [] },
        },
      }),
      session('fallback', now, { model: route, tokenUsage: tokens({ uncachedInputTokens: 1_000_000 }) }),
    ]
    const view = aggregateHistory({ sessions, range: '7d', now, pricing: bandPricing })
    const day = view.days[0]
    expect(day?.costMicros).toBe(15_000_000)
    expect(day?.costMicrosMax).toBe(20_000_000)
    expect(day?.peakCostMicros).toBe(10_000_000)
    expect(day?.offPeakCostMicros).toBe(0)
    expect(day?.otherCostMicros).toBe(5_000_000)
  })

  it('leaves a day unpriced when no route matches the price table', () => {
    const now = localDay(2024, 6, 15, 12, 0)
    const sessions = [
      session('a', now, {
        model: route,
        steps: windowOf(step(now, { uncachedInputTokens: 10 })),
      }),
    ]
    const view = aggregateHistory({ sessions, range: '7d', now, pricing: { currency: 'CNY', prices: [] } })
    expect(view.days[0]?.costMicros).toBeNull()
    expect(view.days[0]?.costUnpriced).toBe(true)
  })
})
