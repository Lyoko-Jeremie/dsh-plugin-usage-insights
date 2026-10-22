/**
 * Cross-conversation usage panel body.
 *
 * Renders the aggregate the Host derives over the Client session list for the
 * selected range: totals, measured coverage, daily bars, and the backfill
 * control for conversations whose usage was never cached.
 */
import type { JSX } from 'react'
import type { AgentTotals, HistoryPanelProps, HistoryRange } from './contract'
import { formatCount, formatMoneyRange, formatPercent, formatTokenCount } from '../lib/format'
import { bandShareText, DailyBars, InlineMessage, Row, Section, Stat, StyleTag } from './components'

/**
 * Summarize one agent kind on a single line.
 *
 * @param totals - per-kind aggregation.
 * @returns measured/total conversations, tokens and cost.
 */
function agentSummary(totals: AgentTotals): string {
  const cost = totals.cost === null
    ? '—'
    : formatMoneyRange(totals.cost.amountMicros, totals.cost.amountMicrosMax, totals.cost.currency)
  return `${formatCount(totals.measured)}/${formatCount(totals.sessions)} · ${formatTokenCount(totals.totalTokens)} · ${cost}`
}

/**
 * Render the usage history panel.
 *
 * @param props - aggregated view, translate seat, selected range and callbacks.
 * @returns the panel body.
 */
export function HistoryPanel(props: HistoryPanelProps): JSX.Element {
  const { view, t, range, onRange, backfill, onBackfill } = props
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
              <div className="dsu-head-value">{formatTokenCount(view.totalTokens)}</div>
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
              <Row label={t('agent.root')} value={agentSummary(view.agents.root)} />
              <Row label={t('agent.subagent')} value={agentSummary(view.agents.subagent)} />
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
