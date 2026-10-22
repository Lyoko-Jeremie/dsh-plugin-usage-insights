/**
 * Minimal structural types for the Harness Client plugin runtime.
 *
 * A plugin bundle must not import any `@deepseek-ai/*` package: those packages
 * change without notice and a plain-JS plugin has no type check against them.
 * These interfaces describe only the members this plugin calls, so the build
 * stays dependency-free while the compiler still checks usage.
 */

/** One registered slot contribution; `Component` receives the declared props. */
export interface SlotsFace {
  inject(name: string, contribute: () => () => void): void
  register(options: SlotRegistration, component: unknown): () => void
}

/** Slot registration options this plugin uses. */
export interface SlotRegistration {
  name: string
  /** Keyed slots dispatch by this key (the tab type's id). */
  key?: string
  /** List slots dispatch by this id. */
  id?: string
  order?: number
  /** Locale namespace that supplies the component's `t` seat. */
  locale?: string
  /** Registrant-private data merged into the component's props. */
  inject?: (sessionId: string) => Record<string, unknown>
}

/** The locale service: register this plugin's dictionaries for its namespace. */
export interface LocaleFace {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
  /**
   * Bind the translate seat of one namespace.
   * @param namespace - registered dictionary namespace.
   * @returns translator for that namespace.
   */
  bind(namespace: string): import('./contract.ts').Translate
}

/** Static definition of one right-Sidebar tab type. */
export interface SidebarTabDefinition {
  /** Implementation identity; the body registers under this same key. */
  id: string
  /** Type discriminator named by `openTab`. */
  kind: string
  title: (address: string) => string
  guide?: readonly {
    id: string
    order: number
    title: () => string
    description?: () => string
  }[]
}

/** Stage-one tab-type registry. */
export interface SidebarRightTabsFace {
  register(definition: SidebarTabDefinition): () => void
}

/** Navigation face of the right Sidebar. */
export interface SidebarRightFace {
  openTab(kind: string, options?: Record<string, unknown>): void
}

/** Session list surface this plugin reads and asks to backfill. */
export interface SessionsFace {
  refreshProjections(sessionId: string): Promise<void>
}

/** One row of the Client session list, as far as this plugin reads it. */
export interface SessionSummaryLike {
  id: string
  updatedAt: number
  /** Human-facing title the Host or catalog projects. */
  displayTitle?: string
  /** Parent conversation for a delegated (subagent or team member) Session. */
  parentId?: string
  origin?: 'subagent'
  /** Whether the conversation currently runs a turn. */
  running?: boolean
  projectionValues?: Readonly<Record<string, unknown>>
}

/** Client session-list snapshot handed to the standard `useSessions` seat. */
export interface SessionListSnapshot {
  ids: readonly string[]
  byId: Readonly<Record<string, SessionSummaryLike>>
}

/**
 * Props a session-scoped slot component receives from the framework, reduced to
 * the standard seats this plugin reads. The injected `measure` is optional: a
 * composition without the sessions service simply shows no backfill control.
 */
export interface SessionScopedProps {
  t: import('./contract.ts').Translate
  sessionId: string
  useProjection: (key: string) => unknown
  useSession: <T>(selector: (snapshot: { running: boolean }) => T) => T
  useSessions: <T>(selector: (snapshot: SessionListSnapshot) => T) => T
  /**
   * Ask the Host for one Session's whole projection set. Delivered by this
   * plugin's inject face; absent in compositions without the sessions service.
   */
  readProjections?: (sessionId: string) => Promise<void>
}

/** Everything `apply` reads from the runtime. */
export interface UsageInsightsContext {
  effect(execute: () => (() => void) | void, label?: string): () => void
  slots: SlotsFace
  locale: LocaleFace
  sidebarRightTabs: SidebarRightTabsFace
  sidebarRight: SidebarRightFace
  sessions: SessionsFace
}
