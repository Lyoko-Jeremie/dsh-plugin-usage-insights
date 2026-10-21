/**
 * Verify the built Client artifact without a browser.
 *
 * Loads `dist/client.js` under a fake `window.__ModuleLoader__`, materializes
 * the registered factory with a stub platform module table, then runs `apply`
 * against a recording context. This proves the artifact registers the two tab
 * types and both bodies — the failures it catches (a bad wrapper, a CJS/module
 * mismatch, a registration typo) otherwise only show up as a blank tab.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = await readFile(join(root, 'dist/client.js'), 'utf8')

let registered
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      registered = entry
    },
  },
}

// The artifact is a classic script; evaluating it registers the factory.
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
if (registered === undefined) throw new Error('client.js did not register a module')

const platform = {
  react: {
    createElement: () => null,
    Fragment: Symbol('Fragment'),
    useState: () => { throw new Error('hook called during apply') },
    useMemo: () => { throw new Error('hook called during apply') },
    useEffect: () => { throw new Error('hook called during apply') },
    useCallback: () => { throw new Error('hook called during apply') },
    useRef: () => { throw new Error('hook called during apply') },
  },
  'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') },
}
const exports = registered.factory(specifier => {
  const mod = platform[specifier]
  if (mod === undefined) throw new Error(`unexpected platform module request: ${specifier}`)
  return mod
})

if (typeof exports.apply !== 'function') throw new Error('client module does not export apply')
if (!Array.isArray(exports.inject)) throw new Error('client module does not export inject')

const calls = []
const disposers = []
const ctx = {
  effect(run, label) {
    calls.push(['effect', label])
    disposers.push(run())
    return () => {}
  },
  locale: {
    bind: namespace => key => `${namespace}:${key}`,
    register(namespace, dictionaries) {
      calls.push(['locale.register', namespace, Object.keys(dictionaries).sort().join(',')])
      return () => {}
    },
  },
  sidebarRightTabs: {
    register(definition) {
      calls.push(['tab.register', definition.id, definition.kind])
      return () => {}
    },
  },
  slots: {
    inject(name, contribute) {
      calls.push(['slots.inject', name])
      disposers.push(contribute())
    },
    register(options) {
      calls.push(['slots.register', options.name, options.key])
      return () => {}
    },
  },
  sessions: { refreshProjections: async () => {} },
}

exports.apply(ctx)

const expected = [
  ['locale.register', 'usageInsights', 'en,zh'],
  ['tab.register', 'dsh-usage-insights', 'usage'],
  ['tab.register', 'dsh-usage-insights.history', 'usage-history'],
  ['slots.inject', 'sidebar.right.pane.tab'],
  ['slots.register', 'sidebar.right.pane.tab', 'dsh-usage-insights'],
  ['slots.inject', 'sidebar.right.pane.tab'],
  ['slots.register', 'sidebar.right.pane.tab', 'dsh-usage-insights.history'],
]
for (const want of expected) {
  const hit = calls.some(call => want.every((value, index) => call[index] === value))
  if (!hit) throw new Error(`missing registration: ${JSON.stringify(want)}; calls: ${JSON.stringify(calls)}`)
}
for (const dispose of disposers) {
  if (typeof dispose === 'function') dispose()
}
console.log(`verified dist/client.js: ${calls.length} registrations, ${disposers.length} disposers`)
