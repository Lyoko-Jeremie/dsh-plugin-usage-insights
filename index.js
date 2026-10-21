/**
 * Host half of the usage-insights bundle.
 *
 * Registers two client-visible session projections — the latest per-request
 * usage with its start timestamp, and a per-day/per-band rollup — so the panel
 * can price requests in the band they actually ran in, survive a reload from
 * the projection cache, and read every live Session independently of which one
 * a browser has open.
 */
import { z } from 'zod'
import { createUsageBandsProjection, createUsageStepsProjection } from './src/host/projection.js'

/** The projections this plugin folds. */
export const inject = ['sessionProjections']

/**
 * Tunables. Limits bound the checkpoint the projection cache writes for every
 * Session and the portion of it a session-list row carries.
 *
 * The outer default matters: a Loader row without a `config:` block hands
 * `undefined` to the schema, and the per-field defaults only apply once an
 * object reaches them.
 */
export const Config = z.object({
  /** Requests retained in the per-step fold (and checkpointed). */
  stepHistory: z.number().int().min(1).default(200),
  /** Requests a client-visible view carries. */
  stepWindow: z.number().int().min(1).default(20),
  /** Beijing days retained in the per-band rollup. */
  bandDays: z.number().int().min(1).default(90),
  /** Mainland Chinese holidays as Beijing `YYYY-MM-DD`; those days bill off-peak. */
  holidays: z.array(z.string()).default([]),
}).default({})

/**
 * Host plugin body: register the per-step and per-band projection units.
 * @param ctx - Host root context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx, config = {}) {
  const stepHistory = config.stepHistory ?? 200
  const settings = {
    stepHistory,
    stepWindow: Math.min(config.stepWindow ?? 20, stepHistory),
    bandDays: config.bandDays ?? 90,
    holidays: config.holidays ?? [],
  }
  ctx.effect(
    () => ctx.sessionProjections.register(createUsageStepsProjection(settings)),
    'usage-insights: usageSteps projection',
  )
  ctx.effect(
    () => ctx.sessionProjections.register(createUsageBandsProjection(settings)),
    'usage-insights: usageBands projection',
  )
}
