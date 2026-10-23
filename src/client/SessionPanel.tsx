/**
 * Single-conversation usage panel body.
 *
 * Renders the Host-published usage projection of the conversation the tab was
 * opened on: token totals, estimated cost, context occupancy, its approximate
 * composition, and the session metrics the session-stats projection reports.
 */
import type { JSX } from 'react'
import type { CostBasis, CostView, SessionPanelProps, Translate } from './contract'
import {
  formatCount,
  formatDuration,
  formatMoneyRange,
  formatPercent,
  formatTokenCount,
  formatTokens,
  formatTokensPerSecond,
} from '../lib/format'
import { peakTokenShare } from '../lib/band-share.ts'
import {
  bandShareText, ChildAgentsTable, CompositionBar, CompositionProgress, HitBar, HitRuler, InlineMessage,
  ProgressBar, Ring, Row, Section, Stat, StepTable, StyleTag, useHitDivisions,
} from './components'
import type { CompositionSegment } from './components'

/**
 * Estimated cost line of the header.
 *
 * @param props - the priced view, or null when no route could be priced.
 * @returns the rendered cost line.
 */
function CostLine(props: { cost: CostView | null; basis: CostBasis; t: Translate }): JSX.Element {
  if (props.cost === null) {
    return (
      <div className="dsu-cost">
        <span className="dsu-cost-note">{props.t('cost.unpriced')}</span>
      </div>
    )
  }
  // One parenthetical states how the amount was derived; a partial estimate
  // keeps its separate note because it qualifies the figure itself.
  const derivation = props.basis === 'bands'
    ? props.t('cost.bandsEstimated')
    : props.t('cost.rangeEstimated')
  return (
    <div className="dsu-cost">
      <span className="dsu-cost-label">{props.t('label.cost')}</span>
      <span className="dsu-cost-amount">
        {formatMoneyRange(props.cost.amountMicros, props.cost.amountMicrosMax, props.cost.currency)}
      </span>
      <span className="dsu-cost-note">{`(${derivation})`}</span>
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
  const { view, t, running, identity } = props
  const hitRuler = useHitDivisions()
  const context = view.context
  const hasContext = context.usedTokens !== null || context.windowTokens !== null || context.ratio !== null
  const breakdown = view.breakdown
  const breakdownTotal =
    breakdown === null ? 0 : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
  const composition: CompositionSegment[] = breakdown === null
    ? []
    : [
      { part: 'system', label: t('context.breakdown.system'), tokens: breakdown.systemTokens },
      { part: 'tools', label: t('context.breakdown.tools'), tokens: breakdown.toolsTokens },
      { part: 'messages', label: t('context.breakdown.messages'), tokens: breakdown.messageTokens },
    ]
  const avgPerTurn = view.turns > 0 ? Math.round(view.totalTokens / view.turns) : 0
  const contextLabel = context.ratio === null ? '—' : formatPercent(context.ratio)
  const peakShare = view.bandShare === null ? null : peakTokenShare(view.bandShare)
  const peakRingLabel = peakShare === null ? '—' : formatPercent(peakShare)
  return (
    <div className="dsu-root">
      <StyleTag />
      <header className="dsu-head">
        <div className="dsu-head-main">
          {view.hasUsage && (
            <>
              <div className="dsu-head-value" title={formatTokenCount(view.totalTokens)}>
                {formatTokens(view.totalTokens)}
              </div>
              <div className="dsu-head-caption">{t('label.tokens')}</div>
              <CostLine cost={view.cost} basis={view.costBasis} t={t} />
            </>
          )}
          {running && (
            <span className="dsu-running" role="status" aria-label={t('state.loading')} title={t('state.loading')}>
              <span className="dsu-dot" aria-hidden="true" />
            </span>
          )}
        </div>
        <div className="dsu-head-side">
          {peakShare !== null && view.bandShare !== null && (
            <div className="dsu-ring-block">
              <Ring
                ratio={peakShare}
                label={peakRingLabel}
                tone="band"
                description={bandShareText(view.bandShare, t, 'tokens')}
              />
              <span className="dsu-head-side-caption">{t('label.bandShare.short')}</span>
            </div>
          )}
          <div className="dsu-ring-block">
            <Ring ratio={context.ratio} label={contextLabel} />
            <span className="dsu-head-side-caption">{t('label.context')}</span>
          </div>
        </div>
      </header>
      <div className="dsu-agent-line">
        <span className="dsu-agent-badge" data-kind={identity.kind}>
          {t(identity.kind === 'subagent' ? 'agent.subagent' : 'agent.root')}
        </span>
        {identity.kind === 'subagent' && identity.parentTitle !== undefined && (
          <span className="dsu-agent-note">{t('agent.parent', { title: identity.parentTitle })}</span>
        )}
      </div>
      {identity.kind === 'root' && identity.children !== undefined && identity.children.list.length > 0 && (
        <details className="dsu-agent-details">
          <summary className="dsu-steps-summary">
            <span className="dsu-chevron" aria-hidden="true" />
            <span className="dsu-section-title">{t('section.subagents')}</span>
            <span className="dsu-steps-meta">
              {t('agent.children', { n: identity.children.count })}
              {' · '}
              {formatTokenCount(identity.children.totalTokens)}
              {identity.children.cost === null
                ? null
                : <> {' · '}{formatMoneyRange(identity.children.cost.amountMicros, identity.children.cost.amountMicrosMax, identity.children.cost.currency)}</>}
            </span>
          </summary>
          <div className="dsu-steps-body">
            <ChildAgentsTable agents={identity.children.list} t={t} />
          </div>
        </details>
      )}
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
              title={formatTokenCount(view.totalTokens)}
              hint={`${t('label.input')} ${formatTokens(view.buckets.uncachedInputTokens)} · ${t('label.output')} ${formatTokens(view.buckets.outputTokens)}`}
            />
            <Stat
              label={t('label.cacheHit')}
              value={view.cacheRate === null ? '—' : formatPercent(view.cacheRate)}
              hint={t('label.cacheHit.hint')}
            />
            <Stat
              label={t('label.cost')}
              value={view.cost === null
                ? '—'
                : formatMoneyRange(view.cost.amountMicros, view.cost.amountMicrosMax, view.cost.currency)}
              hint={view.cost === null
                ? undefined
                : view.costBasis === 'bands'
                  ? t('cost.bands')
                  : view.cost.amountMicrosMax !== undefined
                    ? t('cost.range')
                    : view.cost.complete ? t('label.cost.hint') : t('cost.partial')}
            />
          </div>
          <div className="dsu-rows">
            <Row label={t('label.input')} value={formatTokenCount(view.buckets.uncachedInputTokens)} />
            <Row label={t('label.cacheRead')} value={formatTokenCount(view.buckets.cacheReadTokens)} />
            {/* DeepSeek bills misses as ordinary input and reports no cache
                writes, so the row would read zero forever; show it only for a
                provider that charges explicit cache creation. */}
            {view.buckets.cacheWriteTokens > 0 && (
              <Row label={t('label.cacheWrite')} value={formatTokenCount(view.buckets.cacheWriteTokens)} />
            )}
            <Row label={t('label.output')} value={formatTokenCount(view.buckets.outputTokens)} />
            {view.bandShare !== null && (
              <>
                <Row
                  label={t('label.bandShare.tokens')}
                  value={bandShareText(view.bandShare, t, 'tokens')}
                />
                <Row
                  label={t('label.bandShare.requests')}
                  value={bandShareText(view.bandShare, t, 'requests')}
                />
              </>
            )}
          </div>
        </Section>
      )}
      {view.hasUsage && (
        <Section title={t('section.cacheHit')}>
          <div className="dsu-hits">
            <HitRuler divisions={hitRuler.divisions} trackRef={hitRuler.trackRef} />
            <HitBar divisions={hitRuler.divisions} label={t('cacheHit.total')} ratio={view.cacheHits.total} />
            <HitBar divisions={hitRuler.divisions} label={t('cacheHit.turn')} ratio={view.cacheHits.turn} />
            <HitBar divisions={hitRuler.divisions} label={t('cacheHit.step')} ratio={view.cacheHits.step} />
          </div>
        </Section>
      )}
      {(view.hasUsage || hasContext) && (
        <Section title={t('section.context')}>
          {context.windowTokens === null ? (
            <InlineMessage>{t('context.capacityUnknown')}</InlineMessage>
          ) : (
            <div className="dsu-ctx">
              {context.usedTokens === null ? (
                <InlineMessage>{t('context.notReported')}</InlineMessage>
              ) : (
                <div className="dsu-ctx-line">
                  <span className="dsu-ctx-used">
                    {formatTokens(context.usedTokens)} <span className="dsu-ctx-sep">/</span>{' '}
                    {formatTokens(context.windowTokens)}
                  </span>
                  <span className="dsu-ctx-pct">
                    {contextLabel}
                    {view.compactionThreshold !== null && (
                      <>
                        {' · '}
                        <span className="dsu-ctx-threshold">
                          {t('context.compaction')} {formatPercent(view.compactionThreshold)}
                        </span>
                      </>
                    )}
                  </span>
                </div>
              )}
              {context.usedTokens !== null && (
                <ProgressBar ratio={context.ratio} marker={view.compactionThreshold} />
              )}
              {context.usedTokens !== null && breakdown !== null && breakdownTotal > 0 && (
                <CompositionProgress
                  ratio={context.ratio}
                  segments={composition}
                  marker={view.compactionThreshold}
                />
              )}
              {breakdown !== null && breakdownTotal > 0 && <CompositionBar segments={composition} />}
              {breakdown !== null && <div className="dsu-note">{t('context.breakdown.hint')}</div>}
            </div>
          )}
        </Section>
      )}
      {view.hasUsage && (
        <Section title={t('section.metrics')}>
          <div className="dsu-rows">
            <Row label={t('label.turns')} value={formatCount(view.turns)} />
            <Row label={t('label.steps')} value={formatCount(view.steps)} />
            <Row label={t('label.avgPerTurn')} value={formatTokenCount(avgPerTurn)} />
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
      {view.stepActivity !== null && view.stepActivity.steps.length > 0 && (
        <details className="dsu-steps-details">
          <summary className="dsu-steps-summary">
            <span className="dsu-chevron" aria-hidden="true" />
            <span className="dsu-section-title">{t('section.steps')}</span>
            <span className="dsu-steps-meta">
              {t('steps.count', { n: view.stepActivity.totalSteps })}
            </span>
          </summary>
          <div className="dsu-steps-body">
            <div className="dsu-steps-toolbar">
              <button
                type="button"
                className="dsu-btn"
                aria-pressed={props.showAllSteps}
                onClick={props.onToggleAllSteps}
              >
                {props.showAllSteps ? t('steps.showRecent') : t('steps.showAll')}
              </button>
            </div>
            {view.stepActivity.omittedSteps > 0 && (
              <div className="dsu-note">
                {props.showAllSteps
                  ? t('steps.omitted.all', {
                    shown: view.stepActivity.steps.length,
                    omitted: view.stepActivity.omittedSteps,
                  })
                  : t('steps.omitted', {
                    shown: view.stepActivity.steps.length,
                    total: view.stepActivity.totalSteps,
                  })}
              </div>
            )}
            <StepTable steps={view.stepActivity.steps} t={t} />
          </div>
        </details>
      )}
    </div>
  )
}
