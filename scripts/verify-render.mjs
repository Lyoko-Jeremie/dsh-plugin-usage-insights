/**
 * Render the built bodies outside the Harness to catch crashes and bad output.
 *
 * The artifact is loaded through the same module-loader entry the browser uses;
 * the context records every slot registration so the test can render exactly the
 * components the page would render. Both panels are exercised with populated,
 * partially populated and empty projection values.
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

const require = createRequire(import.meta.url)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = await readFile(join(root, 'dist/client.js'), 'utf8')

let registered
globalThis.window = { __ModuleLoader__: { load(entry) { registered = entry } } }
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

const components = []
const exports = registered.factory(specifier => require(specifier))
const ctx = {
  effect(run) { run(); return () => {} },
  locale: { bind: () => key => key, register: () => () => {} },
  sidebarRightTabs: { register: () => () => {} },
  slots: {
    inject(_name, contribute) { contribute() },
    register(options, component) { components.push({ key: options.key, component }); return () => {} },
  },
  sessions: { refreshProjections: async () => {} },
}
exports.apply(ctx)

const session = components.find(entry => entry.key === 'dsh-usage-insights')?.component
const history = components.find(entry => entry.key === 'dsh-usage-insights.history')?.component
if (session === undefined || history === undefined) throw new Error('both bodies must register')

/** A translate stub that keeps the key visible in the HTML. */
const t = key => `[${key}]`

/** Build the framework props a body receives. */
function propsFor(projections, list, sessionId = 's1') {
  return {
    t,
    sessionId,
    useProjection: key => projections[key],
    useSession: selector => selector({ running: true }),
    useSessions: selector => selector(list),
    measure: async () => {},
  }
}

const stepRow = {
  at: Date.UTC(2026, 9, 21, 2, 0), turn: 1, step: 0, provider: 'deepseek', model: 'deepseek-flash',
  band: 'peak', uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0,
  outputTokens: 0, reasoningTokens: 0,
}

const populated = {
  tokenUsage: { uncachedInputTokens: 48210, outputTokens: 9077, cacheReadTokens: 96000, cacheWriteTokens: 1200 },
  usageSteps: { steps: [stepRow], totalSteps: 3, omittedSteps: 2 },
  usageBands: {
    days: [{ day: '2026-10-21', peak: [{ ...stepRow, requests: 1 }], offPeak: [] }],
    total: { peak: [{ ...stepRow, requests: 1 }], offPeak: [] },
  },
  contextPressure: { pressureTokens: 43000, projectedTokens: 43600, contextWindow: 128000 },
  contextBreakdown: { systemTokens: 6200, toolsTokens: 12800, messageTokens: 24600 },
  usageCompaction: { thresholdRatio: 0.8 },
  sessionStats: {
    turns: 12, steps: 31, llmMs: 123000, toolMs: 45000, ttftMs: 37200, ttftSteps: 31,
    decodeMs: 84000, decodeTokens: 9077,
  },
  modelSelection: {
    lastUsed: { provider: 'deepseek', model: 'deepseek-chat' },
    next: { provider: 'deepseek', model: 'deepseek-chat' },
  },
}

const list = {
  ids: ['s1', 's2', 's3'],
  byId: {
    s1: {
      id: 's1', displayTitle: 'Root conversation',
      updatedAt: Date.now() - 2 * 86_400_000,
      projectionValues: {
        tokenUsage: populated.tokenUsage,
        usageBands: populated.usageBands,
        // The parent's own catalog, in creation order, also lists a child whose
        // row is not part of the session list.
        subagentCatalog: [
          { id: 's2', createdAt: 1, mode: 'continuable', label: 'Delegated work' },
          { id: 's4', createdAt: 2, mode: 'one-shot', label: 'Second child' },
        ],
      },
    },
    s2: {
      id: 's2', displayTitle: 'Delegated work', parentId: 's1', origin: 'subagent',
      updatedAt: Date.now() - 86_400_000,
      projectionValues: {
        tokenUsage: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 4000, cacheWriteTokens: 0 },
        usageSteps: {
          steps: [{ ...stepRow, at: Date.UTC(2026, 9, 21, 3, 0), turn: 2, step: 0 }],
          totalSteps: 1,
          omittedSteps: 0,
        },
      },
    },
    s3: { id: 's3', displayTitle: 'Another conversation', updatedAt: Date.now(), projectionValues: {} },
    s4: {
      id: 's4', displayTitle: 'Second child', parentId: 's1', origin: 'subagent',
      updatedAt: Date.now() - 3600_000,
      projectionValues: {
        tokenUsage: { uncachedInputTokens: 200, outputTokens: 100, cacheReadTokens: 1000, cacheWriteTokens: 0 },
      },
    },
  },
}

const cases = [
  ['session: root', session, propsFor(populated, list),
    ['154K', '34%', '66%', '48,210', '[section.steps]', '1,000,000', '[steps.peak]', '[agent.root]',
      '[agent.children]', '[section.subagents]', '[agents.child]', '[steps.agent]', '#1', '#2',
      '[label.bandShare.tokens]', '[label.bandShare.requests]', '[label.bandShare.short]', 'dsu-ring--band',
      'dsu-compose', 'dsu-compose--progress', 'dsu-progress', 'dsu-progress-marker',
      '[context.compaction]', '[context.breakdown.system]',
      '[section.cacheHit]', '[cacheHit.total]', '[cacheHit.turn]', '[cacheHit.step]', 'dsu-hit', 'dsu-hit-fill',
      'dsu-hit-tick', 'dsu-hit-grid',
      '[steps.showAll]', '[context.breakdown.tools]', '[context.breakdown.messages]']],
  ['session: subagent', session, propsFor(populated, list, 's2'),
    ['[agent.subagent]', '[agent.parent]']],
  ['session: empty', session, propsFor({}, list), ['[empty.noUsage]', '[agent.root]']],
  ['history: populated', history, propsFor({}, list),
    ['1M', '[history.range.7d]', '[section.agents]', '[agent.subagent]',
      '[section.bands]', '[band.byTokens]']],
  ['history: empty', history, propsFor({}, { ids: [], byId: {} }), ['[history.empty]']],
]

for (const [name, component, props, needles] of cases) {
  let html
  try {
    html = renderToString(createElement(component, props))
  } catch (error) {
    throw new Error(`${name} threw during render: ${String(error)}`)
  }
  if (html.length === 0) throw new Error(`${name} rendered nothing`)
  for (const bad of ['NaN', 'undefined', '[object Object]']) {
    if (html.includes(bad)) throw new Error(`${name} rendered "${bad}"`)
  }
  for (const needle of needles) {
    if (!html.includes(needle)) throw new Error(`${name} output is missing ${JSON.stringify(needle)}`)
  }
  console.log(`ok  ${name} (${html.length} B)`)
}

console.log('verified dist/client.js renders both bodies')
