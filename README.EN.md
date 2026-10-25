# dsh-usage-insights

English | [简体中文](README.md)

Token usage, context occupancy, session metrics, and cross-conversation totals in the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web right sidebar.

The plugin is presentation-only: every figure comes from session projections the Harness
already publishes. It writes no session events, adds no model-visible content, and uploads
nothing.

![Usage panel](assets/panel.png)

## Features

The plugin adds two right-Sidebar pages.

### Usage (current conversation)

- **Session overview**: request count, total tokens, input / cache read / output bucket rows
  (the cache-write row appears only when a provider reports explicit cache creation),
  cache-hit rate, cost, and the peak/off-peak share (one row by tokens, one by requests).
- **Cache hit**: three bars for the cumulative, current-turn and latest-request hit rates. The
  fill uses a power scale (`1-(1-r)^0.3`) so the region above 90% keeps its differences. The
  ruler divides the whole track into a power-of-two number of equal segments (2 / 4 / 8 / 16 …
  with no upper bound) and labels each boundary with the hit rate that lands there — at 8
  segments that is 0% / 35.9% / 61.7% / 79.1% / 90.1% / 96.2% / 99.0% / 99.90% / 100%, so the
  tick lines are evenly spaced while their labels are not, and the non-linear axis shows up in
  the numbers themselves. The segment count follows the available width: it doubles only while
  every segment stays at least 40 px wide, so a wider panel earns more segments and the
  narrowest still keeps 2; the tick lines cut into each bar share those positions. The
  percentage keeps three decimals (for example `99.618%`) and is coloured by status: green at
  90% or above, amber from 70%, red below.
- **Token figures**: the overview's Token card (including its input/output hint) uses compact
  `K` / `M` / `G` units; the remaining overview rows, session metrics, subagent detail and
  request ledger show exact grouped integers (for example `275,123,456`); the header total
  (the conversation plus its direct subagents), context window and usage history also use
  compact units, with the exact value on hover.
- **Context window**: the first row shows used / capacity and the occupancy percentage; the
  second row is a bar filled to that occupancy; the third row combines both — its width is the
  occupancy and its three-colour fill is the composition; the fourth row is the whole-window
  composition bar, followed by a colour legend with each part's figure. When the Host can read
  the automatic-compaction threshold, the first two bars carry an amber marker and the first row
  says `Auto-compact 50%`.
- **Peak/off-peak ring**: a second ring left of the context ring draws the peak share as an
  amber arc over a green off-peak track, with the peak percentage in the center (by tokens).
- **Session metrics**: turns, steps, tokens per turn, model time, tool time, first-token
  latency, decode speed.
- **Request table** (collapsed by default, click to expand): the root agent's requests and
  its direct subagents' requests merged into one newest-first ledger (latest 30 rows by
  default, with the delegation-wide total). Each row carries Beijing time, peak/off-peak band,
  the source (`Root`, or the subagent's number `#1`), `turn.step`, model, input / cache read /
  that request's cache-hit rate / output, and that request's cost (the header names the
  currency; cells keep six decimals). The hit rate is that request's cache reads over its
  billed input, the same ratio the cache-hit section shows, kept at three decimals (for
  example `99.618%`); a request that billed no prompt tokens shows `—`. A "Show all" switch
  reveals every request inside the Host's retained window (latest 200 per conversation by
  default).
- **Exact band pricing**: each request is priced in the band its own start fell in, instead
  of applying one price to the whole conversation.
- **Agent identity and subagent detail**: the header says whether the conversation is a root
  agent or a subagent; a subagent shows its parent conversation, and a root agent shows its
  direct subagents' count, total tokens, and cost, expandable into one row per subagent
  (requests, tokens, cache-hit rate, cost, numbered in creation order).
- **Delegation-wide header**: the biggest figure and the cost at the top of the panel cover
  the whole delegation tree — the conversation's own requests plus every direct subagent — and
  the caption under the total reads `incl. N subagents`. The session overview below still
  counts only the conversation's own requests.
- Opening a root conversation's usage page reads the missing band rollups of its subagents
  once (at most 20), turning their figures from an amount range into exact per-band cost.

![Request table](assets/panel-requests.png)

![Subagent detail](assets/panel-subagents.png)

### Usage history (all conversations)

- Range switch: last 24 hours / today / 7 days / 30 days / all. Every figure follows the time
  each *request* actually ran, not the conversation as a whole: a conversation that spans days
  contributes each request to the day it happened, so "Today" never carries yesterday's usage.
  Conversations whose step window is complete are exact to the second; ones that only carry a
  per-day rollup are exact to the Beijing day (so the 24-hour view widens to that day's
  midnight); only conversations with neither fall back to their last activity day.
- Total tokens, conversations with an in-range request / total (with a root/subagent split),
  active days, cache-hit rate, cost.
- **By agent**: root conversations and subagents each list their conversation count, tokens,
  their own cache-hit rate, and cost.
- **Session detail** (collapsed by default): one row per conversation with its title, root or
  subagent kind, in-range token total (exact grouped integer), cache-hit rate and cost (the
  header names the currency, for example `Cost (¥)`; cells keep digits only at six decimals, so
  the column aligns), ordered by tokens.
- **Peak / off-peak share**: by tokens and by requests, counting only conversations that carry
  request times or a per-day rollup and saying so when some do not.
- Daily token chart: bars stack the peak (amber) and off-peak (green) tokens with a legend.
  Every request is grouped by the day and band it actually ran in; only conversations without
  any request-level data fall back to their last activity day and appear gray as unattributed.
- Conversations without request-level data are backfilled automatically (a *Load missing*
  control covers large catalogs).

![Usage history](assets/history.png)

### Persistence and multiple conversations

- The Host half registers two session projections: `usageSteps` (latest 200 requests with
  start time and band) and `usageBands` (per-day, per-band, per-model rollup; 90 daily rows
  plus lifetime totals).
- Both are checkpointed by the Harness projection cache, so reopening a conversation,
  reloading the page, or restarting the app restores them.
- Every conversation folds independently of whether a browser has it open; the history page
  reads each conversation's rollup from the session list, so background conversations count
  live.

## Requirements

- DeepSeek Harness with the Web GUI (`dsh web`). The default Web composition already ships
  `token-meter` and `session-stats`, whose projections this plugin reads.
- Node.js 22+ only when building from source.

## Install

### From GitHub

```sh
dsh plugin install github:Lyoko-Jeremie/dsh-plugin-usage-insights
dsh web
```

### From a local checkout

```sh
dsh plugin install /absolute/path/to/dsh-plugin-usage-insights
dsh web
```

You can also paste the repository URL into a Harness conversation and let the agent install
the bundle with the plugin manager.

After installing, **restart `dsh web`**: the Host half registers its projections at startup,
and a page reload alone does not register them. Reload the page afterwards to load the new
browser module.

### Upgrade

Rebuild and reinstall, restart `dsh web`, then reload the page.

## Opening the panels

- **Composer button**: the bar-chart icon left of the model selector in the message composer
  expands the right Sidebar and opens the usage page directly.
- **Right Sidebar**: expand the column, use `+` in its tab strip, and pick **Usage** or
  **Usage history** from the guide page.

The right Sidebar starts collapsed, and some compositions replace the conversation header, so
the composer button is the reliable entry.

## Data sources and semantics

| Figure | Source | Notes |
|---|---|---|
| Token buckets, cache-hit rate | `tokenUsage` projection | Exact provider-reported counts; the buckets are disjoint. DeepSeek reports no cache writes, so that row is hidden |
| Context used / capacity | `contextPressure` projection | Prompt size of the newest request (or the next-request projection) and model capacity |
| Context composition | `contextBreakdown` projection | Heuristic system / tools / messages estimate, not billed tokens |
| Auto-compaction threshold | This plugin's `usageCompaction` projection | Reads `thresholdRatio` from the resolved `compaction` service config; the optional `compactionThreshold` setting covers compositions where it is unreachable |
| Turns, steps, model/tool time, first token, decode speed | `sessionStats` projection | Whole durable log; paging and compaction do not change it |
| Request table, band, exact cost | This plugin's `usageSteps` / `usageBands` | Folds `step/start`, `assistant/message`, and `assistant/attempt` |
| Cost | Built-in price table | See *Pricing* below |

**Band rule** (matching DeepSeek's documentation, Beijing time): Monday-Friday
09:00-12:00 and 14:00-18:00 is peak; every other hour, whole weekends, and statutory
holidays are off-peak at half price. A weekend turned into a workday by the swap scheme
stays off-peak, because the official rule is weekday-based.

Cost is an **estimate** priced from token counts, not the provider's invoice. A model with no
matching price is reported as *unpriced* instead of `0`.

## Root agents and subagents

DSH models a subagent as its own conversation: the child session's `origin` is `subagent`,
`parentSession` points at the parent, and `delegationDepth` records the nesting. The plugin
uses those fields to distinguish:

- **Root agent**: the root conversation; its panel shows the direct subagents' count, tokens,
  and cost, expandable into a per-subagent table (number, name, requests, tokens, cache hit,
  cost). The request ledger reuses those numbers to label which subagent ran each request.
- **Subagent numbers** come from the parent's own `subagent/catalog` creation records and are
  assigned in creation order. Delegating again appends new numbers and leaves the existing
  ones alone, and a subagent's token growth never reorders the table. A subagent that leaves
  the session list keeps its row, so no other child can take over its number.
- **Subagent**: shows a subagent badge and the parent conversation's title; its usage also
  counts toward the history page's subagent row.
- **History page**: the conversation count splits into root/subagent, and each kind lists its
  own tokens and cost.

Boundaries:

- **Agent Teams members count as subagents.** The experimental Agent Teams feature spawns
  members through `subagents.startActivation`; their sessions are structurally identical to
  ordinary subagents (`origin: subagent`, parent = the Lead) and carry no team field, so they
  cannot be reliably separated at the session level.
- **Request-level sources (compaction, title, planning) are not counted.** Reasonix classifies
  every request by purpose (executor / subagent / planner / compaction / title / …). DSH's
  session log has no such label, and `compaction-basic`'s summarization call plus the
  `session-title-*-llm` generation call never write `assistant/message` events, so this
  plugin's projections cannot see that spend. Matching Reasonix's granularity requires the
  core to record a source and usage at those auxiliary model calls.

## Pricing

The Harness publishes no monetary cost, so the plugin owns the price table in
[`src/client/config.ts`](src/client/config.ts). The shipped table is DeepSeek's official list
price (CNY per million tokens, read 2026-10-21):

| Model | Band | Cache hit | Cache miss | Output |
|---|---|---|---|---|
| `deepseek-flash` | peak | 0.04 | 2 | 8 |
| `deepseek-flash` | off-peak | 0.02 | 1 | 4 |
| `deepseek-v4-pro` | peak | 0.30 | 9 | 27 |
| `deepseek-v4-pro` | off-peak | 0.15 | 4.5 | 13.5 |

Edit the table and rebuild:

```ts
export const PRICING: PricingTable = {
  currency: 'CNY',
  prices: [
    { model: 'deepseek-flash', input: 2, cacheRead: 0.04, cacheWrite: 2, output: 8,
      offPeak: { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 } },
  ],
  // fallback: { input: 2, cacheRead: 0.04, cacheWrite: 2, output: 8 },
}
```

```sh
npm run build   # regenerates dist/client.js
```

The formula follows Reasonix: `amount = Σ tokens × ratePerMillion`, with each bucket rounded
to whole micro-units before summing so sums never drift. A single-band table yields one
amount. A two-band table yields an amount range when per-request data is missing (every token
off-peak as the lower bound, at peak as the upper); with per-request data it prices each
request exactly.

## Statutory holidays

DeepSeek's peak windows exclude mainland Chinese statutory holidays. The plugin bundles the
2025-2026 State Council calendars (extracted through
[`holiday-cn`](https://github.com/NateScarlet/holiday-cn)) and accepts two extensions:

```yaml
config:
  useBuiltinHolidays: true          # false = start from an empty calendar
  holidays: ['2027-01-01']          # individual days
  holidayRanges: ['2027-02-06..2027-02-12']   # inclusive spans
```

### Optional live refresh

```yaml
config:
  holidaySync:
    enabled: true
    urlTemplate: 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json'
    years: []          # empty = the current and next Beijing year
    timeoutMs: 4000
```

When enabled, the Host fetches the year documents at startup and unions them with the
built-in and configured calendar. A failed or slow fetch logs one warning and falls back to
the built-in calendar, because a partial calendar would silently move requests into the wrong
band. The dataset is maintained by a third party (a daily scrape of gov.cn); leave the sync
disabled if you do not want the network dependency.

> DeepSeek exposes no endpoint for the current billing band. The documentation defines the
> windows in prose only, and the account API reports balance, not the active tariff, so the
> plugin always derives each request's band locally from its start time plus the holiday
> calendar.

## Configuration reference

```yaml
- insert:
    - id: usage-insights
      name: dsh-usage-insights
      config:
        stepHistory: 200            # requests folded and checkpointed
        stepWindow: 200             # requests published to the Client ("Show all")
        bandDays: 90                # daily rollup rows retained
        compactionThreshold: 0.5    # optional fallback when no backend ratio is readable
        useBuiltinHolidays: true    # use the bundled 2025-2026 calendar
        holidays: []                # extra holiday days, YYYY-MM-DD
        holidayRanges: []           # extra spans, YYYY-MM-DD..YYYY-MM-DD
        holidaySync:
          enabled: false
          urlTemplate: 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json'
          years: []
          timeoutMs: 4000
```

## Architecture

```
Host (index.js)
├── usageSteps projection: folds step/start + assistant/message + assistant/attempt
│     → latest 200 requests (time, turn, model, four buckets, band)
└── usageBands projection: per-day, per-band, per-model rollup
        │  Harness projection cache checkpoint (restored on reopen/restart)
        ▼
Client (dist/client.js)
├── Usage page: reads tokenUsage / contextPressure / contextBreakdown / sessionStats /
│               usageSteps / usageBands
├── Usage history page: reads each conversation's usageSteps and usageBands from the session list
└── Composer button: expands the right Sidebar and opens the usage page
```

- The Host half only folds projections and resolves the holiday calendar; it renders no UI.
- The Client half imports no `@deepseek-ai/*` client package: it uses only the platform
  baseline (React) plus its own components and styles.
- No session event is added and the session format is unchanged.

## Development

```sh
npm install
npm run typecheck        # TypeScript
npm test                 # Vitest: pricing, bands, projection folds, aggregation, formatting
npm run build            # emits dist/client.js in the Harness module-loader format
npm run verify:bundle    # checks the registration surface under a fake module loader
npm run verify:render    # renders both panels with real React outside the Harness
npm run check            # all of the above
```

Install into a local profile to preview:

```sh
dsh plugin install /absolute/path/to/dsh-plugin-usage-insights
dsh web
```

Layout:

```
index.js              Host half: projections, holiday resolution, optional sync
src/host/             Projection folds and holiday parsing
src/shared/           Band arithmetic shared by Host and Client
src/client/           Registration, panel containers, components, styles, copy
src/lib/              Pure functions: formatting, pricing, aggregation, view derivation
dist/client.js        Built browser artifact
assets/               README screenshots
```

## Known limitations

- The request table is a window: each conversation's Host keeps the latest 200 requests and
  publishes all of them; the root/subagent merge shows the latest 30 by default, and the
  "Show all" switch reveals every published row. Older requests stay only in the session log;
  aggregates still count them.
- Daily rows are retained for 90 days; older days count only toward the lifetime totals.
- Holidays for 2027 and later require the State Council announcement; configure them manually
  or enable the live refresh.
- A rare failed attempt (`assistant/attempt` before any successful message) has no model
  route and is priced at the conversation's current model.
- Subagent conversations count as separate conversations in the history totals; the
  root/subagent split is described above, and team members cannot be separated from ordinary
  subagents at the session level.
- Compaction summaries, title generation, and other auxiliary model calls do not write
  session events, so their spend is outside these totals.
- Cost is an estimate at the configured rates, not the provider's invoice.

## Privacy

- Everything is computed locally; the plugin has no telemetry and uploads no usage data.
- The only possible network request is the optional holiday sync, which fetches public
  holiday JSON only.

## Acknowledgements

- Pricing and band rules from the
  [DeepSeek pricing documentation](https://api-docs.deepseek.com/zh-cn/quick_start/pricing).
- Holiday data from [`NateScarlet/holiday-cn`](https://github.com/NateScarlet/holiday-cn).
- Billing math and information hierarchy informed by Reasonix.

## License

[MIT](LICENSE)
