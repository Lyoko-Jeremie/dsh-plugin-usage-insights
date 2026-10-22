/**
 * Host-side reading of the automatic-compaction pressure threshold.
 *
 * The compaction backend keeps its resolved configuration on the engine
 * instance and publishes none of it, so the usage panel cannot observe the
 * threshold from a projection of its own. These helpers read the value
 * structurally when an Agent is created and hand it to the projection unit
 * that republishes it to the browser.
 *
 * @module dsh-usage-insights/host/compaction
 */

/**
 * Read the threshold ratio a compaction backend resolved for one Agent.
 *
 * Presets mount the backend inside an isolate realm, so the preset registry is
 * consulted before the Agent's own scope; a composition without the basic
 * backend simply yields null.
 *
 * @param {object} agent - Agent created by the loop.
 * @param {{ get?: (name: string) => unknown }} ctx - plugin context.
 * @returns {number | null} the ratio in (0, 1], or null when unreachable.
 */
export function resolveCompactionThreshold(agent, ctx) {
  try {
    const registry = agent?.ctx?.get?.('agentPresets') ?? ctx.get?.('agentPresets')
    const engine = registry?.serviceFor?.(agent, 'compaction') ?? agent?.ctx?.get?.('compaction')
    const config = engine !== null && typeof engine === 'object' ? Reflect.get(engine, 'config') : undefined
    const ratio = config !== null && typeof config === 'object' ? Reflect.get(config, 'thresholdRatio') : undefined
    return typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 && ratio <= 1 ? ratio : null
  } catch {
    // An unreachable or reshaped backend keeps the pressure line hidden
    // instead of failing the turn that created the Agent.
    return null
  }
}

/**
 * Publish the compaction threshold whenever a new Agent resolves one.
 *
 * The read is deferred one macrotask: a profile may carry another
 * `agent/created` listener (for example a threshold-override plugin) that
 * rewrites the engine's resolved config in the same event, and the published
 * value must be the one that actually governs the new Agent.
 *
 * @param {{ on: (event: string, listener: (payload: { agent: object }) => void) => unknown }} ctx - plugin context.
 * @param {(ratio: number | null) => boolean} set - unit update entry point.
 * @returns {void}
 */
export function watchCompactionThreshold(ctx, set) {
  ctx.on('agent/created', ({ agent }) => {
    setTimeout(() => {
      const observed = resolveCompactionThreshold(agent, ctx)
      if (observed !== null) set(observed)
    }, 0)
  })
}
