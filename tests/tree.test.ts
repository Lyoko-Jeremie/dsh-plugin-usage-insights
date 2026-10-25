import { describe, expect, it } from 'vitest'
import type { CostBasis, CostView, SessionIdentity } from '../src/client/contract.ts'
import { treeTotals } from '../src/lib/tree.ts'

/** A priced amount, complete unless a case overrides it. */
function cost(amountMicros: number, extra: Partial<CostView> = {}): CostView {
  return {
    amountMicros,
    currency: 'CNY',
    pricedTokens: 100,
    totalTokens: 100,
    complete: true,
    ...extra,
  }
}

/** A root conversation's catalogued children. */
function children(
  count: number,
  totalTokens: number,
  childCost: CostView | null,
  costBasis: CostBasis,
): NonNullable<SessionIdentity['children']> {
  return { count, totalTokens, cost: childCost, costBasis, list: [] }
}

describe('treeTotals', () => {
  it('leaves a conversation without children unchanged', () => {
    const rootCost = cost(500)
    const totals = treeTotals({ totalTokens: 1_000, cost: rootCost, costBasis: 'bands', children: undefined })

    expect(totals).toEqual({
      totalTokens: 1_000,
      childTokens: 0,
      childCount: 0,
      cost: rootCost,
      costBasis: 'bands',
    })
  })

  it('adds every direct child to the token total', () => {
    const totals = treeTotals({
      totalTokens: 1_000,
      cost: cost(500),
      costBasis: 'bands',
      children: children(3, 750, cost(250), 'bands'),
    })

    expect(totals.totalTokens).toBe(1_750)
    expect(totals.childTokens).toBe(750)
    expect(totals.childCount).toBe(3)
  })

  it('sums exact amounts when both sides priced per request', () => {
    const totals = treeTotals({
      totalTokens: 1_000,
      cost: cost(500),
      costBasis: 'bands',
      children: children(2, 400, cost(250), 'bands'),
    })

    expect(totals.cost).toEqual({
      amountMicros: 750,
      currency: 'CNY',
      pricedTokens: 200,
      totalTokens: 200,
      complete: true,
    })
    expect(totals.costBasis).toBe('bands')
  })

  it('keeps the range basis when a child was only estimated', () => {
    const totals = treeTotals({
      totalTokens: 1_000,
      cost: cost(500),
      costBasis: 'bands',
      children: children(1, 400, cost(250, { amountMicrosMax: 300 }), 'range'),
    })

    expect(totals.cost?.amountMicros).toBe(750)
    expect(totals.cost?.amountMicrosMax).toBe(800)
    expect(totals.costBasis).toBe('range')
  })

  it('marks the amount partial when a child could not be priced', () => {
    const totals = treeTotals({
      totalTokens: 1_000,
      cost: cost(500),
      costBasis: 'bands',
      children: children(1, 400, null, 'none'),
    })

    expect(totals.cost?.amountMicros).toBe(500)
    expect(totals.cost?.complete).toBe(false)
    expect(totals.costBasis).toBe('range')
  })

  it('marks the amount partial when the conversation itself could not be priced', () => {
    const totals = treeTotals({
      totalTokens: 1_000,
      cost: null,
      costBasis: 'range',
      children: children(1, 400, cost(250), 'bands'),
    })

    expect(totals.cost?.amountMicros).toBe(250)
    expect(totals.cost?.complete).toBe(false)
    expect(totals.costBasis).toBe('range')
  })

  it('reports no price when neither side could be priced', () => {
    const totals = treeTotals({
      totalTokens: 1_000,
      cost: null,
      costBasis: 'range',
      children: children(2, 400, null, 'none'),
    })

    expect(totals.cost).toBeNull()
    expect(totals.costBasis).toBe('none')
    expect(totals.totalTokens).toBe(1_400)
  })
})
