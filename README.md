# dsh-usage-insights

Token usage, context occupancy and cross-conversation totals in the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web right
sidebar.

The plugin adds two right-Sidebar pages:

| Page | Shows |
|---|---|
| **Usage** | Session overview (tokens, cache hit, cost), context-window occupancy and composition, session metrics, and a collapsible per-request table (Beijing time, `峰`/`谷` band, model, input/cache/output, that request's cost) that starts folded |
| **Usage history** | Tokens, cache hit rate, active days and a per-day chart aggregated across every conversation, for 7 days / 30 days / all |

The Host half registers two session projections, so the panel prices each
request in the billing band it actually ran in, keeps per-request figures across
a reload, and reads every live conversation independently of which one a
browser has open. No model-visible content and no session events are added; the
projections are derived from the committed log and checkpointed by the Harness
projection cache.

## Requirements

- DeepSeek Harness with the Web GUI (`dsh web`), including the `token-meter`
  and `session-stats` plugins (both ship in the default Web composition).
- Node.js 22+ only for building from source.

## Install

From a checkout:

```sh
# in the Harness CLI
dsh plugin install /absolute/path/to/dsh-usage-insights
dsh web
```

Or from a Git URL:

```sh
dsh plugin install github:<you>/dsh-usage-insights
```

You can also ask the Harness agent to install the bundle directory with the
plugin manager. Reload the page once after installing or upgrading so the
browser loads the new module generation.

Open the panels in either of two ways:

- **Composer button** — the small bar-chart icon to the left of the model
  selector in the message composer opens the right Sidebar directly on the
  usage page for the current conversation.
- **Right Sidebar** — expand the column, then use `+` in its tab strip and pick
  **Usage** or **Usage history** from the guide page.

The right Sidebar starts collapsed, and a composition may replace the
conversation session header, so the composer button is the reliable entry.

The Host half registers projections at startup: after installing or upgrading,
restart `dsh web` (a page reload alone does not register them), then reload the
page.

## Per-request data

Two Host projections do the work:

| Projection | Holds | Limits (default) |
|---|---|---|
| `usageSteps` | Recent requests: start time, turn/step, provider/model, band, four token buckets | 200 folded, the latest 20 reach the panel |
| `usageBands` | Lifetime and per-day rollup, split by billing band and model | 90 days retained |

- **Bands** follow DeepSeek's rule: Beijing time Monday-Friday 09:00-12:00 and
  14:00-18:00 is peak; everything else is off-peak at half price. Holidays are
  configured, not derived: `holidays: ['2026-10-01', ...]` under `config:` in
  the bundle patch marks those Beijing days as off-peak.
- **Persistence** is the Harness projection cache: reopening a conversation or
  restarting the app restores both projections from the checkpoint.
- **Multiple conversations** are folded independently by the Host, whether or
  not a browser has them open; the history page finds their rollups in the
  session-list projection values.
- **Requests whose log entry names no route** (a failed attempt before the
  first message) are priced at the conversation's current route.

Tune the limits in the bundle patch:

```yaml
- insert:
    - id: usage-insights
      name: dsh-usage-insights
      config:
        stepHistory: 200
        stepWindow: 20
        bandDays: 90
        useBuiltinHolidays: true
        holidays: []            # extra YYYY-MM-DD days
        holidayRanges: []       # extra YYYY-MM-DD..YYYY-MM-DD spans
        holidaySync:
          enabled: false
          urlTemplate: 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json'
          years: []             # empty: current and next Beijing year
          timeoutMs: 4000
```

## Statutory holidays

DeepSeek bills peak hours on Beijing weekdays **excluding statutory holidays**.
The plugin ships a calendar for 2025-2026 (from the State Council
announcements, extracted through
[`holiday-cn`](https://github.com/NateScarlet/holiday-cn)), and you can extend
it two ways:

```yaml
config:
  useBuiltinHolidays: true      # false = start from an empty calendar
  holidays: ['2027-01-01']      # single days
  holidayRanges: ['2027-02-06..2027-02-12']
```

**Why weekends never need configuration:** the official rule is
"Monday-Friday excluding statutory holidays", so a Saturday that the State
Council turns into a swap workday is still billed off-peak. Only `isOffDay`
days in the announcement matter, and they matter only when they fall on a
weekday.

### Automatic refresh (optional)

```yaml
config:
  holidaySync:
    enabled: true
    urlTemplate: 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json'
    years: []           # empty: the current and next Beijing year
    timeoutMs: 4000
```

At startup the Host fetches the year documents, keeps `isOffDay: true` days,
and unions them with the built-in and configured calendar. A failed or slow
fetch never blocks the panel: it logs one warning and falls back to the
built-in calendar, because a partial calendar would silently move requests into
the wrong band. The dataset is maintained by a third party (daily scrape of
gov.cn) and is fetched from a CDN; enable this only if you want the newest year
without upgrading the plugin.

### Can the current band be fetched from DeepSeek?

No. As of 2026-10-21 the official documentation
([Models & Pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing))
defines the windows as prose only; the API exposes no pricing-band endpoint, and
the account API reports balance, not the active tariff. Community tooling such
as [`dsh-deepseek-price`](https://github.com/oxgbl/dsh-deepseek-price) also
computes the band locally from the Beijing-time rule. The plugin therefore
derives every request's band from its own start timestamp plus the holiday
calendar — no network call is needed at billing time.

## Pricing (optional)

The Harness publishes no monetary cost, so the plugin prices the four usage
buckets itself. The shipped table is DeepSeek's official list price (CNY per
million tokens, read 2026-10-21 from the
[pricing page](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)):

| Model | Band | Cache hit | Cache miss | Output |
|---|---|---|---|---|
| `deepseek-flash` | peak | 0.04 | 2 | 8 |
| `deepseek-flash` | off-peak | 0.02 | 1 | 4 |
| `deepseek-v4-pro` | peak | 0.30 | 9 | 27 |
| `deepseek-v4-pro` | off-peak | 0.15 | 4.5 | 13.5 |

Peak is Beijing time Monday-Friday 09:00-12:00 and 14:00-18:00 excluding
mainland holidays; every other hour, including whole weekends, is off-peak at
half the peak rate. DeepSeek bills no separate cache-write line (a cache write
is uncached input), so `cacheWrite` repeats `input`.

Edit `PRICING` in [`src/client/config.ts`](src/client/config.ts) to change
rates and rebuild:

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

Rates are **per million tokens**. The formula is the one Reasonix uses:
`amount = Σ tokens × ratePerMillion`, each bucket rounded to a whole micro-unit
before summing, so sums never drift in floating point. Two consequences of the
cumulative projection matter here:

- **Cost is exact when the band rollup is available.** Every request is priced
  in the band its start fell in, so the panel shows one amount labelled
  "priced per request band".
- **A fallback conversation yields a range.** A conversation whose band rollup
  has not been read yet is priced from its cumulative counters: every token
  off-peak (lower bound) and at peak (upper bound), shown as e.g.
  `¥3.70 – ¥7.40` with a *Load missing* control.
- **Unpriced routes never show `0`.** A route with no matching entry and no
  `fallback` is reported as *unpriced*; a total that mixes priced and unpriced
  usage is marked partial. History is never repriced; the figures are an
  estimate at the configured rates, not the provider's invoice.

## What the numbers mean

| Figure | Source | Notes |
|---|---|---|
| Tokens, input/output/cache read/cache write | `tokenUsage` projection | Exact provider buckets; cache reads and writes are disjoint from uncached input |
| Cache hit | `tokenUsage` | `cacheRead ÷ (uncached + cacheRead + cacheWrite)` |
| Requests | `sessionStats.steps` | Model calls, not turns; the durable count of closed steps |
| Turns / model time / tool time | `sessionStats` | Whole durable log, unaffected by paging or compaction |
| First token / decode speed | `sessionStats` | `ttftMs ÷ ttftSteps`, `decodeTokens ÷ decodeMs` |
| Context used / capacity | `contextPressure` | `projectedTokens` (provider-anchored next-request size), `contextWindow` |
| Context composition | `contextBreakdown` | Heuristic estimate of system / tools / messages — not billed tokens |
| Cost | plugin price table | Estimate from the four buckets |
| Usage history | session-list projection values | Includes cold conversations served from the persisted projection cache |

The context composition and the projected size are estimates by design: the
Harness prices text at a fixed density and anchors only to provider-reported
prompt sizes. Treat them as reference figures, never as billing records.

## Known limitations (v0.3)

- **The request table is a window.** The Host folds the latest 200 requests and
  the panel receives the latest 20 of them; older requests stay only in the
  session log. The per-band rollup still counts every request.
- **Band retention is 90 days.** Daily rows older than that are dropped from the
  rollup, while its lifetime totals keep counting them.
- **Holidays are configuration.** A mainland holiday that is not listed in
  `holidays` is billed as a peak weekday, so its cost is over-estimated.
- **No reasoning-token bucket in the cumulative view.** `usageSteps` carries
  `reasoningTokens` per request, but the session-level `tokenUsage` projection
  merges reasoning into output.
- **Pricing lives in source.** Edit `src/client/config.ts` and rebuild.
- **Days are exact only with the band rollup.** A conversation that still falls
  back to cumulative counters lands on its last activity day and the panel
  labels that; a conversation with a rollup counts each request on the day it
  ran.
- **Subagent conversations are separate rows.** Their tokens are real, so they
  are included in the history totals and in the conversation count.
- **Cold rows without a projection checkpoint stay missing** until the
  automatic backfill (or the *Load missing* button) reads their projections
  from the Host.
- **The usage page opens empty on a new conversation.** That is the empty
  state, not a failure: a conversation with no billed request has no usage to
  report.

## Development

```sh
npm install
npm run typecheck
npm test            # vitest over the pure derivations
npm run build       # bundles dist/client.js in the Harness module-loader format
```

Layout:

```
index.js            Host half (no registrations in v0.1)
src/client/         Browser half: registration, slot bodies, view, containers
src/lib/            Pure derivations: formatting, pricing, aggregation, usage
tests/              Unit tests for the derivations
locale/             Plugin Manager title/description (en, zh)
```

The Client bundle must not import any `@deepseek-ai/*` package: it receives
React and the rest of the platform baseline through the Harness module table.
`src/client/runtime.ts` declares the minimal structural types of the services
the plugin calls.

## 中文说明

在 DeepSeek Harness Web 右栏显示 Token 用量、上下文占用、会话指标与跨会话汇总，
只有展示层，不写入任何会话日志。

- 安装：`dsh plugin install <本目录绝对路径>`，重启后打开右栏 `+` → 「用量」/「用量汇总」。
- 费用：编辑 `src/client/config.ts` 的 `PRICING` 后 `npm run build` 重新构建；
  价格按每百万 token 填写，未配置价格的模型显示为「未配置」而不是 0。
- 数据来源：`tokenUsage`、`contextPressure`、`contextBreakdown`、`sessionStats`
  四个会话投影；汇总页读取会话列表里缓存的投影值。
- 已知限制：暂无逐回合明细、无推理 token 单独分桶、上下文构成为启发式估算。

## License

MIT
