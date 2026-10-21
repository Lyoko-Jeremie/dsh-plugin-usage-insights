import { describe, expect, it } from 'vitest'
import {
  readBreakdown, readContextPressure, readModelSelection, readSessionStats, readTokenUsage,
} from '../src/client/readers.ts'

describe('readTokenUsage', () => {
  it('reads the four buckets, defaulting unreported optional caches to zero', () => {
    expect(readTokenUsage({ uncachedInputTokens: 10, outputTokens: 5 })).toEqual({
      uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0,
    })
  })

  it('rejects a value missing a required bucket', () => {
    expect(readTokenUsage({ uncachedInputTokens: 10 })).toBeUndefined()
    expect(readTokenUsage(null)).toBeUndefined()
    expect(readTokenUsage(undefined)).toBeUndefined()
  })

  it('rejects negative or fractional counts', () => {
    expect(readTokenUsage({ uncachedInputTokens: -1, outputTokens: 1 })).toBeUndefined()
    expect(readTokenUsage({ uncachedInputTokens: 1.5, outputTokens: 1 })).toBeUndefined()
  })
})

describe('readContextPressure', () => {
  it('keeps whichever fields are present', () => {
    expect(readContextPressure({ projectedTokens: 1200, contextWindow: 128000 }))
      .toEqual({ pressureTokens: undefined, projectedTokens: 1200, contextWindow: 128000 })
  })

  it('is undefined when it carries nothing', () => {
    expect(readContextPressure({})).toBeUndefined()
    expect(readContextPressure('x')).toBeUndefined()
  })
})

describe('readBreakdown', () => {
  it('requires all three composition figures', () => {
    expect(readBreakdown({ systemTokens: 1, toolsTokens: 2, messageTokens: 3 }))
      .toEqual({ systemTokens: 1, toolsTokens: 2, messageTokens: 3 })
    expect(readBreakdown({ systemTokens: 1, toolsTokens: 2 })).toBeUndefined()
  })
})

describe('readSessionStats', () => {
  it('fills unread timing fields with zero', () => {
    expect(readSessionStats({ turns: 2, steps: 3 })).toEqual({
      turns: 2, steps: 3, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0,
    })
  })

  it('requires both counted fields', () => {
    expect(readSessionStats({ turns: 2 })).toBeUndefined()
  })
})

describe('readModelSelection', () => {
  it('reads the projected route', () => {
    expect(readModelSelection({
      lastUsed: { provider: 'deepseek', model: 'chat' },
      next: { provider: 'deepseek', model: 'reasoner' },
    })).toEqual({
      lastUsed: { provider: 'deepseek', model: 'chat' },
      next: { provider: 'deepseek', model: 'reasoner' },
    })
  })

  it('turns an absent route into null', () => {
    expect(readModelSelection({ lastUsed: null, next: null })).toEqual({ lastUsed: null, next: null })
    expect(readModelSelection({})).toEqual({ lastUsed: null, next: null })
    expect(readModelSelection({ next: { provider: '', model: 'x' } })?.next).toBeNull()
  })
})
