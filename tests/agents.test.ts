import { describe, expect, it } from 'vitest'
import type { BandModelView, PricingTable, UsageBandsView } from '../src/client/contract.ts'
import { collectChildAgents, summarizeChildAgents } from '../src/lib/agents.ts'
import type { ChildAgentInput } from '../src/lib/agents.ts'

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
function bandChild(
  id: string,
  title: string,
  totalTokens: number,
  createdAt?: number,
): ChildAgentInput & { bands: UsageBandsView } {
  return {
    id,
    title,
    running: false,
    updatedAt: 1,
    ...(createdAt === undefined ? {} : { createdAt }),
    model: { provider: 'deepseek', model: 'deepseek-flash' },
    bands: {
      days: [],
      total: { peak: [entry(2, totalTokens)], offPeak: [] },
    },
  }
}

describe('summarizeChildAgents', () => {
  it('prices a child exactly from its band rollup', () => {
    const rows = summarizeChildAgents([bandChild('a', 'Delegated A', 1_000_000, 10)], pricing)
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

  it('numbers children in creation order instead of spend order', () => {
    const rows = summarizeChildAgents([
      bandChild('first', 'First', 1_000_000, 10),
      bandChild('second', 'Second', 3_000_000, 20),
      bandChild('third', 'Third', 2_000_000, 30),
    ], pricing)
    expect(rows.map(row => row.id)).toEqual(['first', 'second', 'third'])
    expect(rows.map(row => row.index)).toEqual([1, 2, 3])
  })

  it('keeps a child number when its spend changes', () => {
    const before = summarizeChildAgents([
      bandChild('first', 'First', 1_000_000, 10),
      bandChild('second', 'Second', 5_000_000, 20),
    ], pricing)
    const after = summarizeChildAgents([
      bandChild('first', 'First', 9_000_000, 10),
      bandChild('second', 'Second', 5_000_000, 20),
    ], pricing)
    expect(after.map(row => row.id)).toEqual(before.map(row => row.id))
    expect(after.map(row => row.index)).toEqual(before.map(row => row.index))
  })

  it('appends children without a catalog record after the catalogued ones', () => {
    const rows = summarizeChildAgents([
      bandChild('uncatalogued', 'Uncatalogued', 1_000_000),
      bandChild('catalogued', 'Catalogued', 2_000, 10),
    ], pricing)
    expect(rows.map(row => row.id)).toEqual(['catalogued', 'uncatalogued'])
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

describe('collectChildAgents', () => {
  it('orders the catalog by creation and fills in list rows by id', () => {
    const collected = collectChildAgents(
      [
        { id: 'a', createdAt: 10, label: 'Catalogued A' },
        { id: 'b', createdAt: 20, label: '' },
      ],
      [bandChild('b', 'Listed B', 1), bandChild('a', '', 2)],
    )
    expect(collected.map(row => row.id)).toEqual(['a', 'b'])
    expect(collected.map(row => row.createdAt)).toEqual([10, 20])
    // A listed title wins; an empty one falls back to the catalog label.
    expect(collected[0]?.title).toBe('Catalogued A')
    expect(collected[1]?.title).toBe('Listed B')
  })

  it('keeps a catalogued child that has no list row', () => {
    const collected = collectChildAgents([{ id: 'gone', createdAt: 10, label: 'Left the list' }], [])
    expect(collected).toEqual([{
      id: 'gone',
      title: 'Left the list',
      running: false,
      updatedAt: 0,
      createdAt: 10,
      model: null,
    }])
  })

  it('appends a row the catalog does not list and counts it once', () => {
    const collected = collectChildAgents(
      [{ id: 'a', createdAt: 10, label: 'A' }],
      [bandChild('a', 'A', 1), bandChild('orphan', 'Orphan', 2)],
    )
    expect(collected.map(row => row.id)).toEqual(['a', 'orphan'])
    expect(collected[1]?.createdAt).toBeUndefined()
  })

  it('does not duplicate a child catalogued twice', () => {
    const collected = collectChildAgents(
      [{ id: 'a', createdAt: 10, label: 'A' }, { id: 'a', createdAt: 11, label: 'A again' }],
      [bandChild('a', 'A', 1)],
    )
    expect(collected).toHaveLength(1)
    expect(collected[0]?.createdAt).toBe(10)
  })
})
