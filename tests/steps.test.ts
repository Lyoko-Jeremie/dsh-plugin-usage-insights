import { describe, expect, it } from 'vitest'
import type { StepActivityView, StepDetailView } from '../src/client/contract.ts'
import { mergeStepActivity } from '../src/lib/steps.ts'

/** One priced request row. */
function detail(at: number, agentIndex: number | null): StepDetailView {
  return {
    at,
    turn: 1,
    step: 0,
    provider: 'deepseek',
    model: 'deepseek-flash',
    band: 'peak',
    uncachedInputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cost: null,
    agentIndex,
  }
}

/** One activity window. */
function activity(steps: StepDetailView[], totalSteps = steps.length): StepActivityView {
  return { steps, totalSteps, omittedSteps: Math.max(0, totalSteps - steps.length) }
}

describe('mergeStepActivity', () => {
  it('returns null when no side carries rows', () => {
    expect(mergeStepActivity(null, [], 10)).toBeNull()
  })

  it('numbers child rows and leaves root rows unnumbered', () => {
    const merged = mergeStepActivity(
      activity([detail(300, null)]),
      [
        { index: 1, activity: activity([detail(200, null)]) },
        { index: 2, activity: activity([detail(100, null)]) },
      ],
      10,
    )
    expect(merged?.steps.map(step => ({ at: step.at, agent: step.agentIndex }))).toEqual([
      { at: 300, agent: null },
      { at: 200, agent: 1 },
      { at: 100, agent: 2 },
    ])
  })

  it('sorts newest first and keeps the latest rows within the limit', () => {
    const merged = mergeStepActivity(
      activity([detail(500, null), detail(100, null)]),
      [{ index: 1, activity: activity([detail(400, null), detail(300, null), detail(200, null)]) }],
      3,
    )
    expect(merged?.steps.map(step => step.at)).toEqual([500, 400, 300])
    expect(merged?.omittedSteps).toBe(2)
  })

  it('reports the delegation-wide request total', () => {
    const merged = mergeStepActivity(
      activity([detail(1, null)], 10),
      [
        { index: 1, activity: activity([detail(2, null)], 7) },
        { index: 2, activity: null },
      ],
      10,
    )
    expect(merged?.totalSteps).toBe(17)
    expect(merged?.omittedSteps).toBe(15)
  })

  it('breaks ties by agent number so the root sorts first', () => {
    const merged = mergeStepActivity(
      activity([detail(100, null)]),
      [{ index: 1, activity: activity([detail(100, null)]) }],
      10,
    )
    expect(merged?.steps.map(step => step.agentIndex)).toEqual([null, 1])
  })
})
