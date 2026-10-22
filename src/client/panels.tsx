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
import type { CostView, HistoryRange, HistorySessionInput, SessionIdentity } from './contract.ts'
import { aggregateHistory } from '../lib/aggregate.ts'
import { summarizeChildAgents } from '../lib/agents.ts'
import { mergeCosts } from '../lib/pricing.ts'
import { mergeStepActivity } from '../lib/steps.ts'
import type { NumberedStepActivity } from '../lib/steps.ts'
import { decorateStepDetails, deriveSessionUsage } from '../lib/usage.ts'
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

/** Rows in the merged request ledger across the delegation tree. */
const MERGED_STEP_LIMIT = 40

/** Child conversations whose band rollup the panel reads at most once. */
const CHILD_BACKFILL_LIMIT = 20

/** How many child projection reads stay in flight. */
const CHILD_BACKFILL_CONCURRENCY = 3

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

  // A child whose band rollup was never read still prices as a range. Read the
  // missing children once so the table can show exact cost and request counts;
  // the cap keeps opening a heavily delegated conversation from folding dozens
  // of cold logs at once.
  const requestedChildren = useRef(new Set<string>())
  useEffect(() => {
    const read = props.readProjections
    if (read === undefined) return
    const pending = (identity.children?.list ?? [])
      .filter(row => !requestedChildren.current.has(row.id))
      .filter(row => row.costBasis === 'range'
        || readSteps(list.byId[row.id]?.projectionValues?.usageSteps) === undefined)
      .map(row => row.id)
    if (pending.length === 0) return
    const capped = pending.slice(0, CHILD_BACKFILL_LIMIT)
    for (const id of capped) requestedChildren.current.add(id)
    void (async () => {
      let cursor = 0
      const worker = async (): Promise<void> => {
        while (cursor < capped.length) {
          const id = capped[cursor]
          cursor += 1
          if (id === undefined) continue
          try {
            await read(id)
          } catch {
            // The row keeps its range; the next open retries.
          }
        }
      }
      await Promise.all(Array.from(
        { length: Math.min(CHILD_BACKFILL_CONCURRENCY, capped.length) },
        () => worker(),
      ))
    })()
  }, [identity, list, props.readProjections])

  // One request ledger across the delegation tree: the root's own requests plus
  // each subagent's recent requests, tagged with the subagent's table number.
  const childActivities = useMemo<NumberedStepActivity[]>(
    () => (identity.children?.list ?? []).map(row => {
      const summary = list.byId[row.id]
      const activity = decorateStepDetails(
        readSteps(summary?.projectionValues?.usageSteps),
        readModelSelection(summary?.projectionValues?.modelSelection)?.next ?? null,
        PRICING,
      )
      return { index: row.index, activity }
    }),
    [identity, list],
  )
  const mergedView = useMemo(() => {
    const merged = mergeStepActivity(view.stepActivity, childActivities, MERGED_STEP_LIMIT)
    return merged === view.stepActivity ? view : { ...view, stepActivity: merged }
  }, [view, childActivities])

  return <SessionPanel view={mergedView} t={props.t} running={running === true} identity={identity} />
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
  const children = list.ids
    .map(id => list.byId[id])
    .filter((child): child is SessionSummaryLike => child !== undefined && child.parentId === sessionId)
    .map(child => ({
      id: child.id,
      title: child.displayTitle ?? child.id,
      running: child.running === true,
      updatedAt: child.updatedAt,
      tokenUsage: readTokenUsage(child.projectionValues?.tokenUsage),
      bands: readBands(child.projectionValues?.usageBands),
      steps: readSessionStats(child.projectionValues?.sessionStats)?.steps,
      model: readModelSelection(child.projectionValues?.modelSelection)?.next ?? null,
    }))
  if (children.length === 0) return { kind: 'root' }
  const rows = summarizeChildAgents(children, PRICING)
  let cost: CostView | null = null
  let exact = true
  let priced = false
  for (const row of rows) {
    if (row.cost === null) continue
    priced = true
    exact = exact && row.costBasis === 'bands'
    cost = cost === null ? row.cost : mergeCosts(cost, row.cost)
  }
  return {
    kind: 'root',
    children: {
      count: rows.length,
      totalTokens: rows.reduce((total, row) => total + row.totalTokens, 0),
      cost,
      costBasis: cost === null ? 'none' : exact ? 'bands' : 'range',
      list: rows,
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
