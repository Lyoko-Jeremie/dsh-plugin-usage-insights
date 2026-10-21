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
function propsFor(projections, list) {
  return {
    t,
    sessionId: 's1',
    useProjection: key => projections[key],
    useSession: selector => selector({ running: true }),
    useSessions: selector => selector(list),
    measure: async () => {},
  }
}

const populated = {
  tokenUsage: { uncachedInputTokens: 48210, outputTokens: 9077, cacheReadTokens: 96000, cacheWriteTokens: 1200 },
  contextPressure: { pressureTokens: 43000, projectedTokens: 43600, contextWindow: 128000 },
  contextBreakdown: { systemTokens: 6200, toolsTokens: 12800, messageTokens: 24600 },
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
    s1: { id: 's1', updatedAt: Date.now() - 2 * 86_400_000, projectionValues: { tokenUsage: populated.tokenUsage } },
    s2: { id: 's2', updatedAt: Date.now() - 86_400_000, projectionValues: { tokenUsage: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 4000, cacheWriteTokens: 0 } } },
    s3: { id: 's3', updatedAt: Date.now(), projectionValues: {} },
  },
}

const cases = [
  ['session: populated', session, propsFor(populated, list), ['154k', '34%', '66%', '48k']],
  ['session: empty', session, propsFor({}, list), ['[empty.noUsage]']],
  ['history: populated', history, propsFor({}, list), ['160k', '[history.range.7d]']],
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
