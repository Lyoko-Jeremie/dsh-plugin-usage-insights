# dsh-usage-insights

Token usage, context occupancy and cross-conversation totals in the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web right
sidebar.

The plugin adds two right-Sidebar pages:

| Page | Shows |
|---|---|
| **Usage** | Session overview (tokens, cache hit, cost), context-window occupancy and composition, session metrics (turns, steps, model/tool time, first-token latency, decode speed) |
| **Usage history** | Tokens, cache hit rate, active days and a per-day chart aggregated across every conversation, for 7 days / 30 days / all |

It is presentation-only: every figure comes from session projections the
Harness already publishes. No model-visible content, no session events and no
Host state are added.

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
plugin manager. After installing, open the right Sidebar (`+` in its tab strip)
and pick **Usage** or **Usage history** from the guide page.

To upgrade a local checkout after rebuilding, reinstall the bundle and restart
the app; the browser module generation is only reloaded on restart.

## Pricing (optional)

The Harness publishes no monetary cost, so the plugin prices the four usage
buckets itself. Edit `PRICING` in [`src/client/config.ts`](src/client/config.ts)
and rebuild:

```ts
export const PRICING: PricingTable = {
  currency: 'CNY',
  prices: [
    { model: 'deepseek-chat', input: 2, cacheRead: 0.5, cacheWrite: 2, output: 3 },
  ],
  // fallback: { input: 2, cacheRead: 0.5, cacheWrite: 2, output: 3 },
}
```

Rates are **per million tokens**. The formula is the one Reasonix uses:
`amount = Σ tokens × ratePerMillion`, accumulated as integer micro-units to
avoid float drift. A route with no matching entry (and no `fallback`) is
reported as *unpriced* instead of being shown as `0`, and a total that mixes
priced and unpriced usage is marked partial.

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

## Known limitations (v0.1)

- **No per-turn table.** The running panel shows session totals only; a
  per-turn and per-model breakdown needs a Host-side projection and is planned
  for v0.2.
- **No reasoning-token bucket.** The cumulative `tokenUsage` projection merges
  reasoning into output; `TokenUsage.reasoningTokens` is not projected.
- **Pricing lives in source.** Edit `src/client/config.ts` and rebuild; the
  Host plugin `Config` seam arrives with v0.2.
- **Daily buckets use each conversation's last activity day.** The session list
  exposes `updatedAt` but no per-turn timestamps, so a conversation active
  across several days lands on one day. The panel labels this.
- **Subagent conversations are separate rows.** Their tokens are real, so they
  are included in the history totals and in the conversation count.
- **Cold rows without a projection checkpoint stay missing** until the
  automatic backfill (or the *Load missing* button) reads their projections
  from the Host.

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
