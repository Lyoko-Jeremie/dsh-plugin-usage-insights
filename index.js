/**
 * Host half of the usage-insights bundle.
 *
 * Registers two client-visible session projections — the latest per-request
 * usage with its start timestamp and billing band, and a per-day/per-band
 * rollup — so the panel can price requests in the band they actually ran in,
 * survive a reload from the projection cache, and read every live Session
 * independently of which one a browser has open.
 *
 * The holiday calendar behind the band decision is built-in for 2025-2026,
 * extendable from configuration, and optionally refreshed from the public
 * `holiday-cn` dataset at startup.
 */
import { z } from 'zod'
import { createCompactionThresholdUnit, createUsageBandsProjection, createUsageStepsProjection } from './src/host/projection.js'
import { watchCompactionThreshold } from './src/host/compaction.js'
import { fetchRemoteHolidays, resolveHolidays, syncYears, unionDays } from './src/host/holidays.js'

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
  /**
   * Requests a client-visible view carries. The panel's "show all" switch can
   * only reach rows the Host publishes, so this defaults to the whole fold.
   */
  stepWindow: z.number().int().min(1).default(200),
  /** Beijing days retained in the per-band rollup. */
  bandDays: z.number().int().min(1).default(90),
  /** Use the bundled 2025-2026 statutory-holiday snapshot. */
  useBuiltinHolidays: z.boolean().default(true),
  /** Extra statutory holiday days as Beijing `YYYY-MM-DD`. */
  holidays: z.array(z.string()).default([]),
  /** Extra statutory holiday spans as Beijing `YYYY-MM-DD..YYYY-MM-DD`. */
  holidayRanges: z.array(z.string()).default([]),
  /**
   * Manual automatic-compaction pressure ratio, used when no backend exposes
   * one. The panel draws this line in the context window.
   */
  compactionThreshold: z.number().min(0).max(1).optional(),
  /** Optional live refresh of the holiday calendar at startup. */
  holidaySync: z.object({
    enabled: z.boolean().default(false),
    /** URL template with `{year}`; the dataset is `holiday-cn`'s year document. */
    urlTemplate: z.string().default(
      'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
    ),
    /** Years to fetch; empty means the current and next Beijing year. */
    years: z.array(z.number().int().min(2000).max(2100)).default([]),
    timeoutMs: z.number().int().min(500).max(30_000).default(4000),
  }).default({}),
}).default({})

/**
 * Host plugin body: resolve the holiday calendar, optionally refresh it, then
 * register the per-step, per-band and compaction-threshold projection units.
 *
 * @param ctx - Host root context.
 * @param config - validated plugin configuration.
 */
export async function apply(ctx, config = {}) {
  const stepHistory = config.stepHistory ?? 200
  const settings = {
    stepHistory,
    stepWindow: Math.min(config.stepWindow ?? 200, stepHistory),
    bandDays: config.bandDays ?? 90,
    holidays: resolveHolidays(config),
  }

  const sync = config.holidaySync ?? {}
  if (sync.enabled === true) {
    try {
      const remote = await fetchRemoteHolidays({
        years: syncYears(sync.years, Date.now()),
        urlTemplate: sync.urlTemplate ?? 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json',
        timeoutMs: sync.timeoutMs ?? 4000,
      })
      settings.holidays = unionDays(settings.holidays, remote)
    } catch (error) {
      // A failed sync must not move usage into a guessed band: keep the
      // built-in and configured calendar and say so once.
      ctx.logger?.warn?.(`usage-insights: holiday sync failed, using the built-in calendar: ${String(error)}`)
    }
  }

  ctx.effect(
    () => ctx.sessionProjections.register(createUsageStepsProjection(settings)),
    'usage-insights: usageSteps projection',
  )
  ctx.effect(
    () => ctx.sessionProjections.register(createUsageBandsProjection(settings)),
    'usage-insights: usageBands projection',
  )

  // The automatic-compaction threshold lives only in the backend's resolved
  // configuration, which no session projection publishes. Read it when an
  // Agent is created and republish it so the context window can draw the
  // pressure line that triggers compaction.
  const compaction = createCompactionThresholdUnit()
  if (config.compactionThreshold !== undefined) compaction.set(config.compactionThreshold)
  ctx.effect(
    () => ctx.sessionProjections.register(compaction.definition),
    'usage-insights: usageCompaction projection',
  )
  watchCompactionThreshold(ctx, compaction.set)
}
