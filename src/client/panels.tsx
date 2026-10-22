/**
 * Slot bodies registered into the right Sidebar.
 *
 * Each body is the only place allowed to touch the framework seats: it reads
 * projections or the session list, derives a plain view object, and hands that
 * to a pure presentational component. The presentational components stay
 * framework-free so they can be read, tested and restyled without the runtime.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PRICING } from './config.ts'
import type { HistoryRange, HistorySessionInput, SessionIdentity } from './contract.ts'
import { aggregateHistory } from '../lib/aggregate.ts'
import { deriveSessionUsage } from '../lib/usage.ts'
import { HistoryPanel } from './HistoryPanel.tsx'
import { SessionPanel } from './SessionPanel.tsx'
import type { SessionListSnapshot, SessionScopedProps, SessionSummaryLike } from './runtime.ts'
import {
  readBands, readBreakdown, readContextPressure, readModelSelection, readSessionStats, readSteps, readTokenUsage,
} from './readers.ts'

/** How many projection reads the backfill keeps in flight. */
const BACKFILL_CONCURRENCY = 4

/** Opened tabs backfill automatically only while the missing set stays small. */
const AUTO_BACKFILL_LIMIT = 40

/**
 * Single-conversation panel body: project the four live projections into the
 * view model and render it. Every value updates when the Host commits an event;
 * the component never polls.
 * @param props - framework props including the translate seat and projection hooks.
 * @returns the rendered panel.
 */
export function UsagePanelBody(props: SessionScopedProps) {
  const tokenUsage = props.useProjection('tokenUsage')
  const contextPressure = props.useProjection('contextPressure')
  const contextBreakdown = props.useProjection('contextBreakdown')
  const sessionStats = props.useProjection('sessionStats')
  const modelSelection = props.useProjection('modelSelection')
  const usageSteps = props.useProjection('usageSteps')
  const usageBands = props.useProjection('usageBands')
  const running = props.useSession(snapshot => snapshot.running)

  // Projections are push-only: a page that opened this Session before the Host
  // published a value (or a resumed page whose baseline predates the key) reads
  // undefined until the next frame. Ask once for the whole set instead of
  // waiting for the conversation to move.
  const hydrateRequested = useRef(false)
  const readProjections = props.readProjections
  // Any projection this panel reads may be missing: the Session opened before
  // the Host registered the unit, or the page resumed from an older baseline.
  // Ask once for the whole set instead of waiting for the next frame.
  const missing = tokenUsage === undefined || usageSteps === undefined || usageBands === undefined
  useEffect(() => {
    if (readProjections === undefined || !missing) return
    if (hydrateRequested.current) return
    hydrateRequested.current = true
    void readProjections(props.sessionId).catch(() => {
      // A failed read leaves the panel in its degraded state; the next Host
      // frame or a manual reopen retries, and a slot must not surface an
      // unhandled rejection.
      hydrateRequested.current = false
    })
  }, [readProjections, props.sessionId, missing])

  const view = useMemo(() => deriveSessionUsage({
    tokenUsage: readTokenUsage(tokenUsage),
    contextPressure: readContextPressure(contextPressure),
    contextBreakdown: readBreakdown(contextBreakdown),
    sessionStats: readSessionStats(sessionStats),
    modelSelection: readModelSelection(modelSelection),
    steps: readSteps(usageSteps),
    bands: readBands(usageBands),
    pricing: PRICING,
  }), [tokenUsage, contextPressure, contextBreakdown, sessionStats, modelSelection, usageSteps, usageBands])

  // Delegation identity comes from the session list, not from a projection: a
  // Root and a delegated Session are told apart by the summary's `origin` and
  // `parentId`, which every composition already publishes.
  const list = props.useSessions(snapshot => snapshot)
  const identity = useMemo(
    () => buildIdentity(props.sessionId, list),
    [props.sessionId, list],
  )

  return <SessionPanel view={view} t={props.t} running={running === true} identity={identity} />
}

/**
 * Describe the conversation's place in the delegation tree.
 *
 * A subagent (including an Agent Teams teammate, which is spawned as a subagent
 * child) reports its parent title. A root conversation reports its direct
 * children's usage, priced through the same aggregation as the history page.
 *
 * @param sessionId - conversation the panel shows.
 * @param list - current session-list snapshot.
 * @returns the identity the panel header renders.
 */
function buildIdentity(sessionId: string, list: SessionListSnapshot): SessionIdentity {
  const summary = list.byId[sessionId]
  if (summary?.origin === 'subagent') {
    const parent = summary.parentId === undefined ? undefined : list.byId[summary.parentId]
    return {
      kind: 'subagent',
      ...(parent?.displayTitle === undefined ? {} : { parentTitle: parent.displayTitle }),
    }
  }
  const childIds = list.ids.filter(id => list.byId[id]?.parentId === sessionId)
  if (childIds.length === 0) return { kind: 'root' }
  const children = childIds
    .map(id => list.byId[id])
    .filter((child): child is SessionSummaryLike => child !== undefined)
    .map(child => toHistoryInput(child))
  const view = aggregateHistory({ sessions: children, range: 'all', now: Date.now(), pricing: PRICING })
  const totals = view.agents.subagent
  return {
    kind: 'root',
    children: {
      count: children.length,
      totalTokens: totals.totalTokens,
      cost: totals.cost,
      costBasis: totals.costBasis,
    },
  }
}

/**
 * Cross-conversation panel body: aggregate the session list's retained
 * projection values by local activity day. Rows without a cached value are
 * counted as missing and can be backfilled one projection read at a time;
 * partial sums are always reported as partial.
 * @param props - framework props including the session-list seat and the injected read request.
 * @returns the rendered panel.
 */
export function UsageHistoryPanelBody(props: SessionScopedProps) {
  const list = props.useSessions(snapshot => snapshot)
  const [range, setRange] = useState<HistoryRange>('7d')
  const [backfill, setBackfill] = useState<'idle' | 'loading'>('idle')
  const requested = useRef(new Set<string>())

  const rows = useMemo(
    () => historyRows(list.ids, list.byId),
    [list],
  )
  const now = useMemo(() => Date.now(), [list, range])
  const view = useMemo(
    () => aggregateHistory({ sessions: rows, range, now, pricing: PRICING }),
    [rows, range, now],
  )

  const onBackfill = useCallback(() => {
    const readProjections = props.readProjections
    if (readProjections === undefined || backfill === 'loading') return
    // A row without a band rollup needs a projection read even when its
    // cumulative counters are cached: only the rollup makes cost exact.
    const pending = view.missingCount + view.fallbackCount === 0
      ? []
      : rows
        .filter(row => row.bands === undefined && !requested.current.has(row.id))
        .map(row => row.id)
    if (pending.length === 0) return
    for (const id of pending) requested.current.add(id)
    setBackfill('loading')
    void (async () => {
      try {
        let cursor = 0
        const worker = async (): Promise<void> => {
          while (cursor < pending.length) {
            const id = pending[cursor]
            cursor += 1
            if (id === undefined) continue
            try {
              await readProjections(id)
            } catch {
              // One unreadable conversation must not stop the batch; its row
              // stays in the missing count and the user can retry.
            }
          }
        }
        await Promise.all(Array.from(
          { length: Math.min(BACKFILL_CONCURRENCY, pending.length) },
          () => worker(),
        ))
      } finally {
        setBackfill('idle')
      }
    })()
  }, [backfill, props.readProjections, rows, view.missingCount, view.fallbackCount])

  // A freshly opened tab would otherwise never load its uncached rows. Keyed by
  // the stale count alone: re-running on every view rebuild would restart a
  // batch that is already in flight. Large histories stay manual so opening the
  // tab cannot kick off hundreds of Host log folds.
  const staleCount = view.missingCount + view.fallbackCount
  useEffect(() => {
    if (staleCount === 0 || staleCount > AUTO_BACKFILL_LIMIT) return
    if (props.readProjections === undefined) return
    onBackfill()
  }, [staleCount])

  return (
    <HistoryPanel
      view={view}
      t={props.t}
      range={range}
      onRange={setRange}
      backfill={backfill}
      onBackfill={onBackfill}
    />
  )
}

/**
 * Turn session-list rows into aggregation inputs.
 * @param ids - host list order.
 * @param byId - rows by id; a missing row is skipped.
 * @returns one input per row that carries a usable activity time.
 */
function historyRows(
  ids: readonly string[],
  byId: Readonly<Record<string, SessionSummaryLike>>,
): HistorySessionInput[] {
  const rows: HistorySessionInput[] = []
  for (const id of ids) {
    const summary = byId[id]
    if (summary === undefined) continue
    rows.push(toHistoryInput(summary))
  }
  return rows
}

/**
 * Project one session-list row into an aggregation input.
 * @param summary - session-list row.
 * @returns its usage values, route, and delegation kind.
 */
function toHistoryInput(summary: SessionSummaryLike): HistorySessionInput {
  const tokenUsage = readTokenUsage(summary.projectionValues?.tokenUsage)
  const bands = readBands(summary.projectionValues?.usageBands)
  return {
    id: summary.id,
    updatedAt: summary.updatedAt,
    ...(tokenUsage === undefined ? {} : { tokenUsage }),
    ...(bands === undefined ? {} : { bands }),
    model: readModelSelection(summary.projectionValues?.modelSelection)?.next ?? null,
    kind: summary.origin === 'subagent' ? 'subagent' : 'root',
  }
}
