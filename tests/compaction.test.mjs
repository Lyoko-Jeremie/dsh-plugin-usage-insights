import { describe, expect, it } from 'vitest'
import { resolveCompactionThreshold, watchCompactionThreshold } from '../src/host/compaction.js'

/** A stand-in compaction engine carrying its resolved config. */
function engine(thresholdRatio) {
  return { config: { thresholdRatio } }
}

/** An Agent whose scope resolves the given services. */
function agentWith(compaction, registry) {
  return {
    ctx: {
      get(name) {
        if (name === 'compaction') return compaction
        if (name === 'agentPresets') return registry
        return undefined
      },
    },
  }
}

/** A plugin context without any service. */
const ctx = { get: () => undefined }

describe('resolveCompactionThreshold', () => {
  it('reads the ratio from the Agent scope', () => {
    expect(resolveCompactionThreshold(agentWith(engine(0.55)), ctx)).toBe(0.55)
  })

  it('prefers the engine a preset mount owns', () => {
    const presetEngine = engine(0.42)
    const agent = agentWith(engine(0.9), { serviceFor: () => presetEngine })
    expect(resolveCompactionThreshold(agent, ctx)).toBe(0.42)
  })

  it('returns null without a reachable engine', () => {
    expect(resolveCompactionThreshold(agentWith(undefined), ctx)).toBeNull()
    expect(resolveCompactionThreshold(undefined, ctx)).toBeNull()
    expect(resolveCompactionThreshold({ ctx: { get: () => undefined } }, ctx)).toBeNull()
  })

  it('rejects a ratio outside the open unit interval', () => {
    expect(resolveCompactionThreshold(agentWith(engine(0)), ctx)).toBeNull()
    expect(resolveCompactionThreshold(agentWith(engine(2)), ctx)).toBeNull()
    expect(resolveCompactionThreshold(agentWith(engine('0.5')), ctx)).toBeNull()
  })

  it('returns null when the backend lookup throws', () => {
    const agent = { ctx: { get() { throw new Error('isolated') } } }
    expect(resolveCompactionThreshold(agent, ctx)).toBeNull()
  })
})

describe('watchCompactionThreshold', () => {
  it('publishes the observed ratio when an Agent is created', async () => {
    let listener
    const seen = []
    watchCompactionThreshold({ on: (_event, handler) => { listener = handler } }, (ratio) => {
      seen.push(ratio)
      return true
    })
    listener({ agent: agentWith(engine(0.6)) })
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(seen).toEqual([0.6])
  })

  it('leaves the published value alone without a reachable backend', async () => {
    let listener
    const seen = []
    watchCompactionThreshold({ on: (_event, handler) => { listener = handler } }, (ratio) => {
      seen.push(ratio)
      return true
    })
    listener({ agent: agentWith(undefined) })
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(seen).toEqual([])
  })
})
