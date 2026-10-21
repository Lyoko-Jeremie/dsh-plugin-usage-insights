/**
 * Plugin-owned pricing.
 *
 * The Harness publishes no monetary cost: providers report token counts only,
 * and the shipped adapters deliberately zero their own cost metadata. The
 * panel therefore prices the four usage buckets itself, with the Reasonix
 * formula: `amount = Σ tokens × ratePerMillion` (micro units), never showing 0
 * for an unknown route.
 *
 * The table below is DeepSeek's official list price, CNY per million tokens,
 * read from <https://api-docs.deepseek.com/zh-cn/quick_start/pricing> on
 * 2026-10-21:
 *
 * | model            | band    | cache hit | cache miss | output |
 * |------------------|---------|-----------|------------|--------|
 * | deepseek-flash   | peak    | 0.04      | 2          | 8      |
 * | deepseek-flash   | off-peak| 0.02      | 1          | 4      |
 * | deepseek-v4-pro  | peak    | 0.30      | 9          | 27     |
 * | deepseek-v4-pro  | off-peak| 0.15      | 4.5        | 13.5   |
 *
 * Peak is Beijing time Monday-Friday 09:00-12:00 and 14:00-18:00 excluding
 * mainland Chinese holidays; every other hour, including whole weekends, is
 * off-peak at half the peak rate. DeepSeek bills no separate cache-write line
 * (a cache write is uncached input), so `cacheWrite` repeats `input`.
 *
 * Because the token projections are cumulative, the panel cannot tell which
 * band each request ran in. Both bands are configured, and the panel reports
 * the amount range they bound instead of one fabricated number.
 *
 * Replace or extend `prices` with the rates you pay and rebuild the Client
 * bundle (`npm run build`). Routes without a matching entry stay unpriced:
 * their amount is excluded and the panel says so, rather than under-reporting
 * as zero.
 */
import type { PricingTable } from './contract.ts'

/** DeepSeek list price with both billing bands; see the module comment. */
export const PRICING: PricingTable = {
  currency: 'CNY',
  prices: [
    {
      model: 'deepseek-flash',
      input: 2,
      cacheRead: 0.04,
      cacheWrite: 2,
      output: 8,
      offPeak: { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
    },
    // Legacy names still served by DeepSeek-V4.1-Flash at the Flash price.
    {
      model: 'deepseek-v4-flash',
      input: 2,
      cacheRead: 0.04,
      cacheWrite: 2,
      output: 8,
      offPeak: { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
    },
    {
      model: 'deepseek-v4-flash-vision-exp',
      input: 2,
      cacheRead: 0.04,
      cacheWrite: 2,
      output: 8,
      offPeak: { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 },
    },
    {
      model: 'deepseek-v4-pro',
      input: 9,
      cacheRead: 0.3,
      cacheWrite: 9,
      output: 27,
      offPeak: { input: 4.5, cacheRead: 0.15, cacheWrite: 4.5, output: 13.5 },
    },
  ],
}
