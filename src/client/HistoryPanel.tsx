/**
 * Cross-conversation usage panel body.
 *
 * Renders the aggregate the Host derives over the Client session list for the
 * selected range: totals, measured coverage, daily bars, and the backfill
 * control for conversations whose usage was never cached.
 */
import type { JSX } from 'react'
import type { AgentTotals, CostView, HistoryPanelProps, HistoryRange } from './contract'
import {
  formatCount, formatMoneyFixed, formatMoneyRange, formatPercent, formatTokenCount, formatTokens,
} from '../lib/format'
import { bandShareText, DailyBars, InlineMessage, Row, Section, Stat, StyleTag } from './components'

/**
 * Summarize one agent kind on a single line.
 *
 * @param totals - per-kind aggregation.
 * @returns measured/total conversations, tokens and cost, plus the exact token
 *   count for the hover title.
 */
function agentSummary(totals: AgentTotals): { text: string; title: string } {
  const cost = totals.cost === null
    ? '—'
    : formatMoneyRange(totals.cost.amountMicros, totals.cost.amountMicrosMax, totals.cost.currency)
  return {
    text: `${formatCount(totals.measured)}/${formatCount(totals.sessions)} · ${formatTokens(totals.totalTokens)} · ${cost}`,
    title: formatTokenCount(totals.totalTokens),
  }
}

/**
 * Render one agent kind's cache-hit rate.
 *
 * @param rate - cache reads over billed input, or null without usage.
 * @returns the percentage, or an em dash.
 */
function hitRateText(rate: number | null): string {
  return rate === null ? '—' : formatPercent(rate)
}

/**
 * Render one conversation's cost with aligned decimals.
 *
 * @param cost - priced amount, or null when unpriced.
 * @returns the amount with three decimals, its two-band range, or an em dash.
 */
function sessionCostText(cost: CostView | null): string {
  if (cost === null) return '—'
  const low = formatMoneyFixed(cost.amountMicros, cost.currency, 3)
  if (cost.amountMicrosMax === undefined || cost.amountMicrosMax === cost.amountMicros) return low
  return `${low} – ${formatMoneyFixed(cost.amountMicrosMax, cost.currency, 3)}`
}

/**
 * Render the usage history panel.
 *
 * @param props - aggregated view, translate seat, selected range and callbacks.
 * @returns the panel body.
 */
export function HistoryPanel(props: HistoryPanelProps): JSX.Element {
  const { view, t, range, onRange, backfill, onBackfill } = props
  const rootSummary = agentSummary(view.agents.root)
  const subagentSummary = agentSummary(view.agents.subagent)
  const rangeOptions: readonly (readonly [HistoryRange, string])[] = [
    ['7d', t('history.range.7d')],
    ['30d', t('history.range.30d')],
    ['all', t('history.range.all')],
  ]
  const empty = view.totalTokens === 0 && view.sessionCount === 0
  return (
    <div className="dsu-root">
      <StyleTag />
      <div className="dsu-range" role="group" aria-label={t('section.history')}>
        {rangeOptions.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="dsu-range-btn"
            aria-pressed={value === range}
            onClick={() => onRange(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {empty ? (
        <InlineMessage>{t('history.empty')}</InlineMessage>
      ) : (
        <>
          <header className="dsu-head">
            <div className="dsu-head-main">
              <div className="dsu-head-value" title={formatTokenCount(view.totalTokens)}>
                {formatTokens(view.totalTokens)}
              </div>
              <div className="dsu-head-caption">{t('history.total')}</div>
            </div>
          </header>
          <div className="dsu-stats">
            <Stat
              label={t('history.sessions')}
              value={`${formatCount(view.measuredCount)} / ${formatCount(view.sessionCount)}`}
              hint={t('history.sessions.split', {
                root: view.agents.root.sessions,
                sub: view.agents.subagent.sessions,
              })}
            />
            <Stat label={t('history.activeDays')} value={formatCount(view.activeDays)} />
            <Stat
              label={t('history.cacheHit')}
              value={view.cacheRate === null ? '—' : formatPercent(view.cacheRate)}
            />
            <Stat
              label={t('history.cost')}
              value={view.cost === null
                ? '—'
                : formatMoneyRange(view.cost.amountMicros, view.cost.amountMicrosMax, view.cost.currency)}
              hint={view.cost === null
                ? undefined
                : view.costBasis === 'bands'
                  ? t('cost.bands')
                  : view.cost.amountMicrosMax !== undefined
                    ? t('cost.range')
                    : view.cost.complete ? undefined : t('cost.partial')}
            />
          </div>
          <Section title={t('section.agents')}>
            <div className="dsu-rows">
              <Row
                label={t('agent.root')}
                value={rootSummary.text}
                title={rootSummary.title}
                hint={`${t('label.cacheHit')} ${hitRateText(view.agents.root.cacheRate)}`}
              />
              <Row
                label={t('agent.subagent')}
                value={subagentSummary.text}
                title={subagentSummary.title}
                hint={`${t('label.cacheHit')} ${hitRateText(view.agents.subagent.cacheRate)}`}
              />
            </div>
          </Section>
          {view.bandShare !== null && (
            <Section title={t('section.bands')}>
              <div className="dsu-rows">
                <Row label={t('band.byTokens')} value={bandShareText(view.bandShare, t, 'tokens')} />
                <Row label={t('band.byRequests')} value={bandShareText(view.bandShare, t, 'requests')} />
              </div>
              {view.bandSharePartial && <div className="dsu-note">{t('band.partial')}</div>}
            </Section>
          )}
          <Section title={t('history.daily')}>
            <DailyBars days={view.days} t={t} />
            <div className="dsu-note">
              {view.costBasis === 'bands' ? t('history.daily.bandsNote') : t('history.daily.note')}
            </div>
          </Section>
          {view.sessions.length > 0 && (
            <details className="dsu-steps-details">
              <summary className="dsu-steps-summary">
                <span className="dsu-chevron" aria-hidden="true" />
                <span className="dsu-section-title">{t('section.sessions')}</span>
                <span className="dsu-steps-meta">{t('sessions.count', { n: view.sessions.length })}</span>
              </summary>
              <div className="dsu-steps-body">
                <div className="dsu-steps-wrap">
                  <table className="dsu-steps">
                    <thead>
                      <tr>
                        <th>{t('sessions.title')}</th>
                        <th>{t('sessions.kind')}</th>
                        <th className="dsu-num">{t('sessions.tokens')}</th>
                        <th className="dsu-num">{t('sessions.cache')}</th>
                        <th className="dsu-num">{t('sessions.cost')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.sessions.map(row => (
                        <tr key={row.id}>
                          <td className="dsu-session-title" title={row.title}>{row.title}</td>
                          <td>{row.kind === 'subagent' ? t('sessions.subagent') : t('sessions.root')}</td>
                          <td className="dsu-num">{formatTokenCount(row.totalTokens)}</td>
                          <td className="dsu-num">
                            {row.cacheRate === null ? '—' : formatPercent(row.cacheRate)}
                          </td>
                          <td className="dsu-num">{sessionCostText(row.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          )}
          {view.missingCount + view.fallbackCount > 0 && (
            <InlineMessage tone="warn">
              <div className="dsu-inline-action">
                <span>{view.missingCount > 0
                  ? t('history.missing', { n: view.missingCount })
                  : t('history.missingBands', { n: view.fallbackCount })}</span>
                <button type="button" className="dsu-btn" onClick={onBackfill} disabled={backfill === 'loading'}>
                  {backfill === 'loading' ? t('history.measuring') : t('history.measure')}
                </button>
              </div>
            </InlineMessage>
          )}
        </>
      )}
    </div>
  )
}
