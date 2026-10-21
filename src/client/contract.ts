/**
 * Data and prop contracts shared by the usage panel, its pure derivations and
 * its presentational components.
 *
 * The panel reads Host-published session projections; every field here is a
 * display value, never a billing record. Inputs are structurally typed copies
 * of the projection wire values so the derivations stay pure and testable
 * without the Harness runtime.
 */
import type { UsageInsightKey } from './locales/en.ts'

/** Namespace-bound translate function handed to a registered slot component. */
export type Translate = (key: UsageInsightKey, vars?: Record<string, string | number>) => string

/** The four disjoint provider usage buckets the wire projection carries. */
export interface TokenBuckets {
  /** Uncached prompt input. */
  uncachedInputTokens: number
  /** Completion tokens, reasoning included. */
  outputTokens: number
  /** Prompt input served from the provider cache. */
  cacheReadTokens: number
  /** Prompt input written to the provider cache. */
  cacheWriteTokens: number
}

/** A provider/model route, as the model-selection projection reports it. */
export interface ModelRef {
  provider: string
  model: string
}

/** One model's per-million-token prices in one currency. */
export interface PriceEntry {
  /** Exact provider, or omitted to match by model alone. */
  provider?: string
  /** Exact model id. */
  model: string
  /** Price per million uncached input tokens. */
  input: number
  /** Price per million cache-read input tokens. */
  cacheRead: number
  /** Price per million cache-write input tokens. */
  cacheWrite: number
  /** Price per million output tokens. */
  output: number
}

/** Plugin-owned price table; there is no Host pricing in the Harness. */
export interface PricingTable {
  /** ISO 4217 code every entry is denominated in. */
  currency: string
  prices: readonly PriceEntry[]
  /** Fallback for routes with no matching entry; omission leaves them unpriced. */
  fallback?: Omit<PriceEntry, 'model' | 'provider'>
}

/** An amount and how much of the usage it covers. */
export interface CostView {
  /** Currency amount in micro units (1e-6 of the currency). */
  amountMicros: number
  currency: string
  /** Tokens that had a price. */
  pricedTokens: number
  /** Tokens the view was built from. */
  totalTokens: number
  /** True when every token had a price. */
  complete: boolean
}

/** Occupancy of the next request against the model's declared capacity. */
export interface ContextView {
  /** Provider-anchored prompt size of the newest request, or the projected next size. */
  usedTokens: number | null
  /** Newest declared route capacity. */
  windowTokens: number | null
  /** `usedTokens / windowTokens`, clamped to [0, 1]; null without both sides. */
  ratio: number | null
  /** Which pressure figure `usedTokens` came from. */
  source: 'projected' | 'pressure' | null
}

/** Heuristic composition of the next request, as the token meter estimates it. */
export interface BreakdownView {
  systemTokens: number
  toolsTokens: number
  messageTokens: number
}

/** Everything the single-conversation panel renders. */
export interface SessionUsageView {
  buckets: TokenBuckets
  /** All four buckets summed. */
  totalTokens: number
  /** Input side of billed prompt tokens: uncached + cache read + cache write. */
  billedInputTokens: number
  /** Cache reads over billed input, or null when no input was billed. */
  cacheRate: number | null
  /** Model calls in this conversation; the session-stats step count in v0.1. */
  requests: number
  turns: number
  steps: number
  /** Summed model wall time. */
  llmMs: number
  /** Summed tool wall time. */
  toolMs: number
  /** Mean first-token latency, or null without a recorded first token. */
  ttftAvgMs: number | null
  /** Provider output tokens per decode second, or null without both figures. */
  decodeTps: number | null
  context: ContextView
  breakdown: BreakdownView | null
  model: ModelRef | null
  cost: CostView | null
  /** False until the first provider usage lands. */
  hasUsage: boolean
}

/** One calendar day of aggregated usage. */
export interface DayTotal {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Conversations that contributed to this day. */
  sessions: number
}

/** The range filter of the cross-conversation view. */
export type HistoryRange = '7d' | '30d' | 'all'

/** Everything the cross-conversation panel renders. */
export interface HistoryView {
  range: HistoryRange
  /** Rows considered after the range filter. */
  sessionCount: number
  /** Rows that carried a usage value. */
  measuredCount: number
  /** Rows the range included but that carried no usage value. */
  missingCount: number
  buckets: TokenBuckets
  totalTokens: number
  cacheRate: number | null
  /** Distinct days with a non-zero total. */
  activeDays: number
  /** Ascending by day; only days with a conversation in range appear. */
  days: DayTotal[]
  cost: CostView | null
}

/** One conversation row fed into the cross-conversation aggregation. */
export interface HistorySessionInput {
  id: string
  /** Last durable activity; the day the conversation's tokens are attributed to. */
  updatedAt: number
  tokenUsage?: TokenBuckets
  /** Route of the conversation, when the caller knows it; null prices by fallback. */
  model: ModelRef | null
}

/** Props of the single-conversation panel body. */
export interface SessionPanelProps {
  view: SessionUsageView
  t: Translate
  /** Whether this conversation currently runs a turn. */
  running: boolean
}

/** Load state of the missing-projection backfill. */
export type BackfillState = 'idle' | 'loading'

/** Props of the cross-conversation panel body. */
export interface HistoryPanelProps {
  view: HistoryView
  t: Translate
  range: HistoryRange
  /** @param range - the range the user selected. */
  onRange: (range: HistoryRange) => void
  /** Whether a backfill for missing rows is running. */
  backfill: BackfillState
  /** Requests projection reads for rows that carried no cached usage. */
  onBackfill: () => void
}

/** Props of a registered slot component that only needs the translate seat. */
export interface TitleProps {
  t: Translate
}
