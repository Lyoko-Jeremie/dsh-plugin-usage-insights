/**
 * Data and prop contracts shared by the usage panel, its pure derivations and
 * its presentational components.
 *
 * The panel reads Host-published session projections; every field here is a
 * display value, never a billing record. Inputs are structurally typed copies
 * of the projection wire values so the derivations stay pure and testable
 * without the Harness runtime.
 */
import type { BillingBand } from '../shared/band.js'
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

/** The four per-million-token rates of one billing band. */
export interface PriceRates {
  /** Price per million uncached input tokens. */
  input: number
  /** Price per million cache-read input tokens. */
  cacheRead: number
  /** Price per million cache-write input tokens. */
  cacheWrite: number
  /** Price per million output tokens. */
  output: number
}

/**
 * One model's per-million-token prices in one currency.
 *
 * The flat fields are the standard (peak) band. A provider that changes its
 * rate by time of day supplies `offPeak`; the panel then reports an amount
 * range instead of pretending a single band applies to a cumulative total.
 */
export interface PriceEntry extends PriceRates {
  /** Exact provider, or omitted to match by model alone. */
  provider?: string
  /** Exact model id. */
  model: string
  /** Off-peak band; omitted when the provider does not vary by time of day. */
  offPeak?: PriceRates
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
  /** Currency amount in micro units (1e-6 of the currency); the lower bound when bands differ. */
  amountMicros: number
  /**
   * Upper-bound amount in micro units when the price table varies by billing
   * band. Absent when one rate applies to every token.
   */
  amountMicrosMax?: number
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

/** One billed request as the Host's `usageSteps` projection reports it. */
export interface UsageStepView {
  /** Start of the step that issued the request. */
  at: number
  turn: number
  step: number
  provider: string
  model: string
  /** Billing band the request start falls in, resolved by the Host. */
  band: BillingBand
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
}

/** One request plus its price, ready for the table. */
export interface StepDetailView extends UsageStepView {
  /** Price of this request in its own band; null when the route is unpriced. */
  cost: CostView | null
  /** 1-based subagent number in the child table; null for the root agent's own requests. */
  agentIndex: number | null
}

/** Tokens and requests split by billing band. */
export interface BandShareView {
  peakTokens: number
  offPeakTokens: number
  peakRequests: number
  offPeakRequests: number
}

/** The recent requests a session's `usageSteps` view carries. */
export interface StepActivityView {
  /** Newest last; bounded by the Host's configured window. */
  steps: readonly StepDetailView[]
  /** Requests the Host has folded, including those outside the window. */
  totalSteps: number
  /** Requests folded but not carried in `steps`. */
  omittedSteps: number
}

/** One model's counters inside one band. */
export interface BandModelView {
  provider: string
  model: string
  requests: number
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
}

/** One day split by billing band. */
export interface BandDayView {
  /** Beijing `YYYY-MM-DD`. */
  day: string
  peak: readonly BandModelView[]
  offPeak: readonly BandModelView[]
}

/** The Host's `usageBands` view: lifetime totals plus one row per day. */
export interface UsageBandsView {
  days: readonly BandDayView[]
  /** Lifetime counters by band (days outside the retention window still count). */
  total: { peak: readonly BandModelView[]; offPeak: readonly BandModelView[] }
}

/** How a cost figure was obtained, so the panel can label its accuracy. */
export type CostBasis = 'bands' | 'range' | 'none'

/** Cache-hit ratio at three scopes of one conversation. */
export interface CacheHitView {
  /** Whole durable log. */
  total: number | null
  /** Requests of the newest turn. */
  turn: number | null
  /** The most recent request. */
  step: number | null
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
  /** Cache-hit ratios by scope; turn and step need the request window. */
  cacheHits: CacheHitView
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
  /** How `cost` was derived. */
  costBasis: CostBasis
  /** Recent requests with times and bands; null until the Host projection is available. */
  stepActivity: StepActivityView | null
  /** Peak/off-peak split of the same conversation; null without a band rollup. */
  bandShare: BandShareView | null
  /**
   * Resolved automatic-compaction pressure as a fraction of the context window,
   * or null when no compaction backend exposed one.
   */
  compactionThreshold: number | null
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
  /** Tokens billed at peak rates. */
  peakTokens: number
  /** Tokens billed off-peak. */
  offPeakTokens: number
  /** Tokens that could not be attributed to a band. */
  unattributedTokens: number
}

/** The range filter of the cross-conversation view. */
export type HistoryRange = '7d' | '30d' | 'all'

/** Which kind of agent a conversation is. */
export type AgentKind = 'root' | 'subagent'

/** Usage rolled up for one agent kind. */
export interface AgentTotals {
  /** Conversations of this kind in range. */
  sessions: number
  /** Conversations of this kind that carried usage. */
  measured: number
  totalTokens: number
  cacheRate: number | null
  cost: CostView | null
  costBasis: CostBasis
}

/** One conversation's row in the per-session history table. */
export interface HistorySessionRow {
  id: string
  /** Display title, falling back to the id. */
  title: string
  kind: AgentKind
  /** Last durable activity. */
  updatedAt: number
  totalTokens: number
  cacheRate: number | null
  cost: CostView | null
  costBasis: CostBasis
}

/** Everything the cross-conversation panel renders. */
export interface HistoryView {
  range: HistoryRange
  /** Rows considered after the range filter. */
  sessionCount: number
  /** Rows that carried a usage value. */
  measuredCount: number
  /** Rows the range included but that carried no usage value. */
  missingCount: number
  /** Conversations priced from cumulative counters because they carried no band rollup. */
  fallbackCount: number
  buckets: TokenBuckets
  totalTokens: number
  cacheRate: number | null
  /** Distinct days with a non-zero total. */
  activeDays: number
  /** Ascending by day; only days with a conversation in range appear. */
  days: DayTotal[]
  cost: CostView | null
  /** How `cost` and `days` were derived. */
  costBasis: CostBasis
  /** Per-kind split of the same range. */
  agents: { root: AgentTotals; subagent: AgentTotals }
  /** One row per measured conversation, largest token total first. */
  sessions: HistorySessionRow[]
  /** Peak/off-peak split of the conversations that carry a band rollup. */
  bandShare: BandShareView | null
  /** True when some conversations had no band rollup and are outside `bandShare`. */
  bandSharePartial: boolean
}

/** One conversation row fed into the cross-conversation aggregation. */
export interface HistorySessionInput {
  id: string
  /** Display title; the row falls back to the id when absent. */
  title?: string
  /** Last durable activity; the fallback day when the conversation has no band rollup. */
  updatedAt: number
  tokenUsage?: TokenBuckets
  /** Route of the conversation, when the caller knows it; null prices by fallback. */
  model: ModelRef | null
  /** Per-day, per-band rollup when the Host projection is available. */
  bands?: UsageBandsView
  /** Root conversation, or a delegated (subagent / team member) conversation. */
  kind?: AgentKind
}

/**
 * One direct child recorded by the root conversation's own subagent catalog.
 *
 * The catalog is the parent's durable creation record: it survives the child
 * leaving the session list and keeps the children in creation order.
 */
export interface CatalogChildEntry {
  /** Child conversation identity. */
  id: string
  /** Child conversation creation time; orders the catalog. */
  createdAt: number
  /** Creation label frozen with the child; empty when its mode carries none. */
  label: string
}

/** One direct child conversation of the root agent. */
export interface ChildAgentView {
  id: string
  title: string
  /**
   * 1-based creation order across the root's direct children, used in the
   * request rows. A child keeps its number for its whole life: delegation after
   * it appends new numbers instead of renumbering the existing children.
   */
  index: number
  /** Whether the child currently runs a turn. */
  running: boolean
  /** Durable activity time, for display. */
  updatedAt: number
  /** Billed model requests the child reported. */
  requests: number
  totalTokens: number
  cacheRate: number | null
  cost: CostView | null
  costBasis: CostBasis
}

/** Identity of the conversation the single-conversation panel shows. */
export interface SessionIdentity {
  kind: AgentKind
  /** Parent conversation title, for a subagent. */
  parentTitle?: string
  /** Direct child conversations, for a root conversation. */
  children?: {
    /** Direct children the parent catalogued; delegation increments it. */
    count: number
    totalTokens: number
    cost: CostView | null
    costBasis: CostBasis
    /** Creation order. */
    list: readonly ChildAgentView[]
  }
}

/** Props of the single-conversation panel body. */
export interface SessionPanelProps {
  view: SessionUsageView
  t: Translate
  /** Whether this conversation currently runs a turn. */
  running: boolean
  /** Whether this conversation is a root agent, and its direct children. */
  identity: SessionIdentity
  /** Whether the request ledger shows every loaded row instead of the newest window. */
  showAllSteps: boolean
  /** Toggle the request ledger window. */
  onToggleAllSteps: () => void
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
