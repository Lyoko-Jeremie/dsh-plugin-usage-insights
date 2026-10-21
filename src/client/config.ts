/**
 * Plugin-owned pricing.
 *
 * The Harness publishes no monetary cost: providers report token counts only,
 * and the shipped adapters deliberately zero their own cost metadata. The
 * panel therefore prices the four usage buckets itself, with the Reasonix
 * formula: `amount = Σ tokens × ratePerMillion` (micro units), never repricing
 * history and never showing 0 for an unknown route.
 *
 * To show costs, fill `PRICING.prices` with the rates you pay and rebuild the
 * Client bundle (`npm run build`). Routes without a matching entry stay
 * unpriced: their amount is excluded and the panel says so, rather than
 * under-reporting as zero.
 */
import type { PricingTable } from './contract.ts'

/** The price table every panel uses. Empty by default: tokens only, no money. */
export const PRICING: PricingTable = {
  currency: 'CNY',
  prices: [
    // Example — replace with your provider's actual per-million-token prices:
    // {
    //   model: 'deepseek-chat',
    //   input: 2,
    //   cacheRead: 0.5,
    //   cacheWrite: 2,
    //   output: 3,
    // },
  ],
}
