import { describe, expect, it } from 'vitest'
import type { BandModelView, PricingTable, UsageBandsView } from '../src/client/contract.ts'
import { summarizeChildAgents } from '../src/lib/agents.ts'

/** DeepSeek flash rates: peak 2/0.04/8, off-peak half. */
const pricing: PricingTable = {
  currency: 'CNY',
  prices: [{
    model: 'deepseek-flash',
    input: 2,
    cacheRead: 0.04,
    cacheWrite: 2,
    output: 8,
    offPeak: { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
  }],
}

/** One model's counters inside one band. */
function entry(requests: number, uncachedInputTokens: number, cacheReadTokens = 0): BandModelView {
  return {
    provider: 'deepseek',
    model: 'deepseek-flash',
    requests,
    uncachedInputTokens,
    cacheReadTokens,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  }
}

/** One child conversation with a band rollup. */
function bandChild(id: string, title: string, totalTokens: number): {
  id: string
  title: string
  running: boolean
  updatedAt: number
  bands: UsageBandsView
  model: { provider: string; model: string } | null
} {
  return {
    id,
    title,
    running: false,
    updatedAt: 1,
    model: { provider: 'deepseek', model: 'deepseek-flash' },
    bands: {
      days: [],
      total: { peak: [entry(2, totalTokens)], offPeak: [] },
    },
  }
}

describe('summarizeChildAgents', () => {
  it('prices a child exactly from its band rollup', () => {
    const rows = summarizeChildAgents([bandChild('a', 'Delegated A', 1_000_000)], pricing)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'a',
      title: 'Delegated A',
      requests: 2,
      totalTokens: 1_000_000,
      costBasis: 'bands',
    })
    expect(rows[0]?.cost?.amountMicros).toBe(2_000_000)
    expect(rows[0]?.cost?.amountMicrosMax).toBeUndefined()
  })

  it('sorts rows by token total, largest first', () => {
    const rows = summarizeChildAgents([
      bandChild('small', 'Small', 1_000_000),
      bandChild('big', 'Big', 3_000_000),
    ], pricing)
    expect(rows.map(row => row.id)).toEqual(['big', 'small'])
    // The table number follows the token order and labels that child's requests.
    expect(rows.map(row => row.index)).toEqual([1, 2])
  })

  it('falls back to cumulative counters as a range and uses the step count', () => {
    const rows = summarizeChildAgents([{
      id: 'b',
      title: 'Only totals',
      running: true,
      updatedAt: 2,
      tokenUsage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      steps: 7,
      model: { provider: 'deepseek', model: 'deepseek-flash' },
    }], pricing)
    expect(rows[0]).toMatchObject({ requests: 7, costBasis: 'range', running: true })
    expect(rows[0]?.cost?.amountMicros).toBe(1_000_000)
    expect(rows[0]?.cost?.amountMicrosMax).toBe(2_000_000)
  })

  it('reports no cost when the child has no usable price', () => {
    const rows = summarizeChildAgents([{
      id: 'c',
      title: '',
      running: false,
      updatedAt: 3,
      tokenUsage: { uncachedInputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      model: null,
    }], pricing)
    expect(rows[0]).toMatchObject({ title: 'c', cost: null, costBasis: 'none', totalTokens: 10 })
  })

  it('uses the conversation route when a rollup entry names none', () => {
    const bands: UsageBandsView = {
      days: [],
      total: { peak: [{ ...entry(1, 1_000_000), provider: '', model: '' }], offPeak: [] },
    }
    const rows = summarizeChildAgents([{
      id: 'd',
      title: 'Unattributed',
      running: false,
      updatedAt: 4,
      bands,
      model: { provider: 'deepseek', model: 'deepseek-flash' },
    }], pricing)
    expect(rows[0]?.cost?.amountMicros).toBe(2_000_000)
    expect(rows[0]?.costBasis).toBe('bands')
  })

  it('counts cache reads in the hit rate', () => {
    const rows = summarizeChildAgents([{
      id: 'e',
      title: 'Cached',
      running: false,
      updatedAt: 5,
      bands: {
        days: [],
        total: { peak: [entry(1, 0, 1_000)], offPeak: [] },
      },
      model: { provider: 'deepseek', model: 'deepseek-flash' },
    }], pricing)
    expect(rows[0]?.cacheRate).toBe(1)
    expect(rows[0]?.totalTokens).toBe(1_000)
  })
})
