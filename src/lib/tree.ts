/**
 * Whole-delegation-tree totals for the usage panel header.
 *
 * A root conversation's own counters cover only the requests it issued itself.
 * Every subagent it delegated to is a separate Session with its own counters,
 * so the header reports the tree: the conversation's own usage plus the direct
 * children's, priced as one amount.
 */
import type { CostBasis, CostView, SessionIdentity } from '../client/contract.ts'
import { mergeCosts } from './pricing.ts'

/** Inputs of {@link treeTotals}. */
export interface TreeTotalsInput {
  /** The conversation's own token total. */
  totalTokens: number
  /** The conversation's own price, or null when its route could not be priced. */
  cost: CostView | null
  /** How the conversation's own price was derived. */
  costBasis: CostBasis
  /** Direct children the conversation catalogued, or undefined for a subagent. */
  children: SessionIdentity['children'] | undefined
}

/** Header figures covering the conversation plus every direct child. */
export interface TreeTotals {
  /** The conversation's own tokens plus every direct child's. */
  totalTokens: number
  /** The direct children's share of `totalTokens`. */
  childTokens: number
  /** Direct children counted; 0 for a subagent or a root that delegated nothing. */
  childCount: number
  /** Combined price, or null when neither side could be priced. */
  cost: CostView | null
  /** `bands` only when both sides were priced per request; `none` when neither was priced. */
  costBasis: CostBasis
}

/**
 * Merge the conversation's own usage with its direct children's.
 *
 * A child whose route had no price makes the combined amount partial, exactly
 * as an unpriced root does: `mergeCosts` marks the result incomplete instead of
 * adding a zero.
 *
 * @param input - the conversation's own figures and its catalogued children.
 * @returns the header totals for the whole delegation tree.
 */
export function treeTotals(input: TreeTotalsInput): TreeTotals {
  const childTokens = input.children?.totalTokens ?? 0
  const childCount = input.children?.count ?? 0
  if (childCount === 0) {
    return {
      totalTokens: input.totalTokens,
      childTokens: 0,
      childCount: 0,
      cost: input.cost,
      costBasis: input.costBasis,
    }
  }
  const childCost = input.children?.cost ?? null
  const childBasis = input.children?.costBasis ?? 'none'
  const cost = mergeCosts(input.cost, childCost)
  // Both sides must be priced per request for the combined amount to keep that
  // basis; an unpriced child leaves only the range fallback accurate.
  const exact = input.cost !== null
    && childCost !== null
    && input.costBasis === 'bands'
    && childBasis === 'bands'
  return {
    totalTokens: input.totalTokens + childTokens,
    childTokens,
    childCount,
    cost,
    costBasis: cost === null ? 'none' : exact ? 'bands' : 'range',
  }
}
