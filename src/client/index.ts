/**
 * Browser half of the usage-insights bundle.
 *
 * Registers two right-Sidebar page types — one for the open conversation, one
 * for cross-conversation totals — plus their bodies and the copy dictionaries.
 * Nothing here mutates any Harness state: every figure is derived from
 * projections the Host already publishes, so the plugin is presentation-only.
 */
import { en } from './locales/en.ts'
import { zh } from './locales/zh.ts'
import { UsageHistoryPanelBody, UsagePanelBody } from './panels.tsx'
import type { UsageInsightsContext } from './runtime.ts'

/** Required browser services: slots, copy, the right-Sidebar tab registry, and session reads. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sessions']

/** This package's copy namespace. */
const NS = 'usageInsights'

/** Implementation identity of the single-conversation tab type. */
const USAGE_TAB = 'dsh-usage-insights'

/** Implementation identity of the cross-conversation tab type. */
const HISTORY_TAB = 'dsh-usage-insights.history'

/**
 * Client plugin body: register copy, two tab types and their bodies.
 * @param ctx - client root context.
 */
export function apply(ctx: UsageInsightsContext): void {
  const t = ctx.locale.bind(NS)

  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'usage-insights: dictionaries')

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: USAGE_TAB,
    kind: 'usage',
    title: () => t('tab.title'),
    guide: [{
      id: 'usage',
      order: 40,
      title: () => t('guide.usage.title'),
      description: () => t('guide.usage.description'),
    }],
  }), 'usage-insights: usage tab type')

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: HISTORY_TAB,
    kind: 'usage-history',
    title: () => t('tab.history.title'),
    guide: [{
      id: 'usage-history',
      order: 41,
      title: () => t('guide.history.title'),
      description: () => t('guide.history.description'),
    }],
  }), 'usage-insights: history tab type')

  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: USAGE_TAB,
    locale: NS,
  }, UsagePanelBody))

  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: HISTORY_TAB,
    locale: NS,
    inject: () => ({
      measure: (sessionId: string) => ctx.sessions.refreshProjections(sessionId),
    }),
  }, UsageHistoryPanelBody))
}
