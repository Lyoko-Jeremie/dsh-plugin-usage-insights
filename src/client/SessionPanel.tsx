/**
 * Single-conversation usage panel body.
 *
 * Renders the Host-published usage projection of the conversation the tab was
 * opened on: token totals, estimated cost, context occupancy, its approximate
 * composition, and the session metrics the session-stats projection reports.
 */
import type { JSX } from 'react'
import type { CostView, SessionPanelProps, Translate } from './contract'
import {
  formatCount,
  formatDuration,
  formatMoney,
  formatPercent,
  formatTokens,
  formatTokensPerSecond,
} from '../lib/format'
import { InlineMessage, MeterBar, Ring, Row, Section, Stat, StyleTag } from './components'

/**
 * Estimated cost line of the header.
 *
 * @param props - the priced view, or null when no route could be priced.
 * @returns the rendered cost line.
 */
function CostLine(props: { cost: CostView | null; t: Translate }): JSX.Element {
  if (props.cost === null) {
    return (
      <div className="dsu-cost">
        <span className="dsu-cost-note">{props.t('cost.unpriced')}</span>
      </div>
    )
  }
  return (
    <div className="dsu-cost">
      <span className="dsu-cost-label">{props.t('label.cost')}</span>
      <span className="dsu-cost-amount">{formatMoney(props.cost.amountMicros, props.cost.currency)}</span>
      <span className="dsu-cost-note">{props.t('cost.estimated')}</span>
      {!props.cost.complete && <span className="dsu-cost-note">{props.t('cost.partial')}</span>}
    </div>
  )
}

/**
 * Render the conversation usage panel.
 *
 * @param props - projected usage view, translate seat and run state.
 * @returns the panel body.
 */
export function SessionPanel(props: SessionPanelProps): JSX.Element {
  const { view, t, running } = props
  const context = view.context
  const hasContext = context.usedTokens !== null || context.windowTokens !== null || context.ratio !== null
  const breakdown = view.breakdown
  const breakdownTotal =
    breakdown === null ? 0 : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
  const avgPerTurn = view.turns > 0 ? Math.round(view.totalTokens / view.turns) : 0
  const contextLabel = context.ratio === null ? '—' : formatPercent(context.ratio)
  return (
    <div className="dsu-root">
      <StyleTag />
      <header className="dsu-head">
        <div className="dsu-head-main">
          {view.hasUsage && (
            <>
              <div className="dsu-head-value">{formatTokens(view.totalTokens)}</div>
              <div className="dsu-head-caption">{t('label.tokens')}</div>
              <CostLine cost={view.cost} t={t} />
            </>
          )}
          {running && (
            <span className="dsu-running" role="status" aria-label={t('state.loading')} title={t('state.loading')}>
              <span className="dsu-dot" aria-hidden="true" />
            </span>
          )}
        </div>
        <div className="dsu-head-side">
          <Ring ratio={context.ratio} label={contextLabel} />
          <span className="dsu-head-side-caption">{t('label.context')}</span>
        </div>
      </header>
      {!view.hasUsage && (
        <InlineMessage>
          <span>{t('empty.noUsage')}</span>
          <span className="dsu-note">{t('empty.noUsage.hint')}</span>
        </InlineMessage>
      )}
      {view.hasUsage && (
        <Section title={t('section.overview')}>
          <div className="dsu-stats">
            <Stat label={t('label.requests')} value={formatCount(view.requests)} hint={t('label.requests.hint')} />
            <Stat
              label={t('label.tokens')}
              value={formatTokens(view.totalTokens)}
              hint={`${t('label.input')} ${formatTokens(view.buckets.uncachedInputTokens)} · ${t('label.output')} ${formatTokens(view.buckets.outputTokens)}`}
            />
            <Stat
              label={t('label.cacheHit')}
              value={view.cacheRate === null ? '—' : formatPercent(view.cacheRate)}
              hint={t('label.cacheHit.hint')}
            />
            <Stat
              label={t('label.cost')}
              value={view.cost === null ? '—' : formatMoney(view.cost.amountMicros, view.cost.currency)}
              hint={view.cost === null ? undefined : view.cost.complete ? t('label.cost.hint') : t('cost.partial')}
            />
          </div>
          <div className="dsu-rows">
            <Row label={t('label.input')} value={formatTokens(view.buckets.uncachedInputTokens)} />
            <Row label={t('label.cacheRead')} value={formatTokens(view.buckets.cacheReadTokens)} />
            <Row label={t('label.cacheWrite')} value={formatTokens(view.buckets.cacheWriteTokens)} />
            <Row label={t('label.output')} value={formatTokens(view.buckets.outputTokens)} />
          </div>
        </Section>
      )}
      {(view.hasUsage || hasContext) && (
        <Section title={t('section.context')} aside={context.ratio === null ? undefined : contextLabel}>
          {context.windowTokens === null ? (
            <InlineMessage>{t('context.capacityUnknown')}</InlineMessage>
          ) : context.usedTokens === null ? (
            <InlineMessage>{t('context.notReported')}</InlineMessage>
          ) : (
            <div className="dsu-ctx">
              <div className="dsu-ctx-line">
                <span className="dsu-ctx-used">
                  {formatTokens(context.usedTokens)} <span className="dsu-ctx-sep">/</span>{' '}
                  {formatTokens(context.windowTokens)}
                </span>
                {context.ratio !== null && <span className="dsu-ctx-pct">{formatPercent(context.ratio)}</span>}
              </div>
              <MeterBar ratio={context.ratio} />
            </div>
          )}
          {breakdown !== null && (
            <div className="dsu-breakdown">
              <div className="dsu-breakdown-row">
                <div className="dsu-breakdown-head">
                  <span className="dsu-row-label">{t('context.breakdown.system')}</span>
                  <span className="dsu-row-value">{formatTokens(breakdown.systemTokens)}</span>
                </div>
                <MeterBar ratio={breakdownTotal > 0 ? breakdown.systemTokens / breakdownTotal : null} />
              </div>
              <div className="dsu-breakdown-row">
                <div className="dsu-breakdown-head">
                  <span className="dsu-row-label">{t('context.breakdown.tools')}</span>
                  <span className="dsu-row-value">{formatTokens(breakdown.toolsTokens)}</span>
                </div>
                <MeterBar ratio={breakdownTotal > 0 ? breakdown.toolsTokens / breakdownTotal : null} />
              </div>
              <div className="dsu-breakdown-row">
                <div className="dsu-breakdown-head">
                  <span className="dsu-row-label">{t('context.breakdown.messages')}</span>
                  <span className="dsu-row-value">{formatTokens(breakdown.messageTokens)}</span>
                </div>
                <MeterBar ratio={breakdownTotal > 0 ? breakdown.messageTokens / breakdownTotal : null} />
              </div>
              <div className="dsu-note">{t('context.breakdown.hint')}</div>
            </div>
          )}
        </Section>
      )}
      {view.hasUsage && (
        <Section title={t('section.metrics')}>
          <div className="dsu-rows">
            <Row label={t('label.turns')} value={formatCount(view.turns)} />
            <Row label={t('label.steps')} value={formatCount(view.steps)} />
            <Row label={t('label.avgPerTurn')} value={formatTokens(avgPerTurn)} />
            <Row label={t('label.modelTime')} value={formatDuration(view.llmMs)} />
            <Row label={t('label.toolTime')} value={formatDuration(view.toolMs)} />
            <Row label={t('label.ttft')} value={view.ttftAvgMs === null ? '—' : formatDuration(view.ttftAvgMs)} />
            <Row
              label={t('label.decode')}
              value={view.decodeTps === null ? '—' : formatTokensPerSecond(view.decodeTps)}
            />
          </div>
        </Section>
      )}
    </div>
  )
}
