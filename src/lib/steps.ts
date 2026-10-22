/**
 * Merge the root agent's request rows with its direct subagents' rows.
 *
 * The panel shows one chronological ledger across the delegation tree: the
 * root's own requests carry no agent number, and each subagent's requests carry
 * the number of its row in the subagent table. Both sides are bounded windows,
 * so the merged list keeps the newest entries and reports how many it omitted.
 */
import type { StepActivityView, StepDetailView } from '../client/contract.ts'

/** One child agent's request window, numbered like the child table. */
export interface NumberedStepActivity {
  /** 1-based row number in the child table. */
  index: number
  activity: StepActivityView | null
}

/**
 * Merge the root and child request windows into one newest-first list.
 *
 * @param root - the root conversation's activity, or null without the projection.
 * @param children - numbered child activities.
 * @param limit - maximum rows in the merged window.
 * @returns the merged activity, or null when no side has rows.
 */
export function mergeStepActivity(
  root: StepActivityView | null,
  children: readonly NumberedStepActivity[],
  limit: number,
): StepActivityView | null {
  const rows: StepDetailView[] = []
  let totalSteps = 0
  if (root !== null) {
    totalSteps += root.totalSteps
    for (const step of root.steps) rows.push({ ...step, agentIndex: null })
  }
  for (const child of children) {
    const activity = child.activity
    if (activity === null) continue
    totalSteps += activity.totalSteps
    for (const step of activity.steps) rows.push({ ...step, agentIndex: child.index })
  }
  if (rows.length === 0) return null
  rows.sort((left, right) =>
    right.at - left.at
    || (left.agentIndex ?? 0) - (right.agentIndex ?? 0))
  const steps = rows.slice(0, limit)
  return {
    steps,
    totalSteps,
    omittedSteps: Math.max(0, totalSteps - steps.length),
  }
}
