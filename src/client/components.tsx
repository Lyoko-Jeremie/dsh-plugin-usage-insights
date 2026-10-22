/**
 * Presentational building blocks shared by the two usage panels.
 *
 * Every component is a pure function of its props: the panels receive Host
 * projections and this module only lays figures out. Colour and typography come
 * from the Harness alias tokens declared in `styles.ts`, never from literal
 * values, so light and dark themes stay readable.
 */
import type { JSX, ReactNode } from 'react'
import type { BandShareView, ChildAgentView, DayTotal, StepDetailView, Translate } from './contract'
import { peakRequestShare, peakTokenShare } from '../lib/band-share.ts'
import { formatBeijingTime, formatCount, formatMoneyRange, formatPercent, formatTokenCount, formatTokens } from '../lib/format'
import { css } from './styles'

/**
 * Inject the panel stylesheet.
 *
 * The panels mount into a sidebar slot and cannot own a document stylesheet, so
 * the stylesheet ships as a single `<style>` element next to the markup.
 *
 * @returns the styled style element.
 */
export function StyleTag(): JSX.Element {
  return <style>{css}</style>
}

/**
 * Titled group of related figures.
 *
 * @param props - section title, optional right-aligned aside and body content.
 * @returns the rendered section.
 */
export function Section(props: { title: string; aside?: ReactNode; children?: ReactNode }): JSX.Element {
  return (
    <section className="dsu-section">
      <div className="dsu-section-head">
        <div className="dsu-section-title">{props.title}</div>
        {props.aside !== undefined && <div className="dsu-section-aside">{props.aside}</div>}
      </div>
      {props.children !== undefined && <div className="dsu-section-body">{props.children}</div>}
    </section>
  )
}

/**
 * Label above a figure, with an optional qualifier.
 *
 * @param props - stat label, value and hint.
 * @returns the rendered stat tile.
 */
export function Stat(props: { label: string; value: string; hint?: string }): JSX.Element {
  return (
    <div className="dsu-stat">
      <div className="dsu-stat-label">{props.label}</div>
      <div className="dsu-stat-value">{props.value}</div>
      {props.hint !== undefined && <div className="dsu-stat-hint">{props.hint}</div>}
    </div>
  )
}

/**
 * Label/value line used for metrics and token buckets.
 *
 * @param props - row label, value node and optional hint.
 * @returns the rendered row.
 */
export function Row(props: { label: string; value: ReactNode; hint?: string }): JSX.Element {
  return (
    <div className="dsu-row">
      <div className="dsu-row-main">
        <span className="dsu-row-label">{props.label}</span>
        {props.hint !== undefined && <span className="dsu-row-hint">{props.hint}</span>}
      </div>
      <span className="dsu-row-value">{props.value}</span>
    </div>
  )
}

/**
 * One segment of the context composition bar.
 */
export interface CompositionSegment {
  /** Stable style key. */
  part: 'system' | 'tools' | 'messages'
  /** Localized name shown in the legend. */
  label: string
  tokens: number
}

/**
 * Stacked composition bar with its colour legend.
 *
 * The bar fills the used context: each segment takes its share of the whole
 * composition, so the three parts read as one picture. Figures stay in the
 * legend, beside the colour they belong to.
 *
 * @param props - the composition segments in display order.
 * @returns the rendered bar and legend.
 */
export function CompositionBar(props: { segments: readonly CompositionSegment[] }): JSX.Element {
  const description = props.segments
    .map(segment => `${segment.label} ${formatTokens(segment.tokens)}`)
    .join(' · ')
  return (
    <>
      <div className="dsu-compose" role="img" aria-label={description}>
        {props.segments.map(segment => segment.tokens > 0 && (
          <span
            key={segment.part}
            className="dsu-compose-seg"
            data-part={segment.part}
            style={{ flexGrow: segment.tokens }}
          />
        ))}
      </div>
      <div className="dsu-compose-legend">
        {props.segments.map(segment => (
          <span key={segment.part}>
            <i className="dsu-swatch" data-part={segment.part} />
            {segment.label} {formatTokens(segment.tokens)}
          </span>
        ))}
      </div>
    </>
  )
}

/**
 * Circular occupancy indicator with its own caption.
 *
 * @param props - ratio in [0, 1] or null for an unknown value, and centre label.
 * @returns the rendered ring.
 */
export function Ring(props: {
  ratio: number | null
  label: string
  /** 'band' colors the value arc peak-amber over an off-peak track. */
  tone?: 'context' | 'band'
  /** Accessible description; defaults to the visible label. */
  description?: string
}): JSX.Element {
  const radius = 16
  const circumference = 2 * Math.PI * radius
  const clamped = props.ratio === null ? null : Math.min(1, Math.max(0, props.ratio))
  return (
    <svg
      className={props.tone === 'band' ? 'dsu-ring dsu-ring--band' : 'dsu-ring'}
      viewBox="0 0 40 40"
      role="img"
      aria-label={props.description ?? props.label}
    >
      {props.description !== undefined && <title>{props.description}</title>}
      <circle className="dsu-ring-track" cx="20" cy="20" r={radius} />
      {clamped !== null && (
        <circle
          className="dsu-ring-value"
          cx="20"
          cy="20"
          r={radius}
          strokeDasharray={`${circumference * clamped} ${circumference}`}
          transform="rotate(-90 20 20)"
        />
      )}
      <text className="dsu-ring-label" x="20" y="20" textAnchor="middle" dominantBaseline="central">
        {props.label}
      </text>
    </svg>
  )
}

/**
 * One column per calendar day, scaled to the largest day in the range.
 *
 * @param props - ascending day totals and the translate seat for the empty state.
 * @returns the rendered bar chart.
 */
export function DailyBars(props: { days: readonly DayTotal[]; t: Translate }): JSX.Element {
  const days = props.days
  if (days.length === 0) {
    return <InlineMessage>{props.t('history.empty')}</InlineMessage>
  }
  let max = 0
  for (const day of days) {
    if (day.totalTokens > max) max = day.totalTokens
  }
  const first = days[0]
  const last = days[days.length - 1]
  const anyUnattributed = days.some(day => day.unattributedTokens > 0)
  return (
    <div className="dsu-bars-wrap">
      <div className="dsu-bars" role="img" aria-label={props.t('history.daily')}>
        {days.map((day) => {
          const height = max > 0 ? (day.totalTokens / max) * 100 : 0
          const empty = height <= 0
          return (
            <div
              key={day.day}
              className={empty ? 'dsu-bar dsu-bar--empty' : 'dsu-bar'}
              style={{ height: empty ? '2px' : `${height}%` }}
              title={`${day.day} · ${formatTokenCount(day.totalTokens)} · ${props.t('steps.peak')} ${formatTokenCount(day.peakTokens)} · ${props.t('steps.offPeak')} ${formatTokenCount(day.offPeakTokens)}`}
            >
              {!empty && (
                <>
                  {day.offPeakTokens > 0 && (
                    <span className="dsu-bar-seg dsu-bar-seg--off" style={{ flexGrow: day.offPeakTokens }} />
                  )}
                  {day.peakTokens > 0 && (
                    <span className="dsu-bar-seg dsu-bar-seg--peak" style={{ flexGrow: day.peakTokens }} />
                  )}
                  {day.unattributedTokens > 0 && (
                    <span className="dsu-bar-seg dsu-bar-seg--other" style={{ flexGrow: day.unattributedTokens }} />
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
      <div className="dsu-bars-legend">
        <span><i className="dsu-swatch dsu-swatch--peak" />{props.t('steps.peak')}</span>
        <span><i className="dsu-swatch dsu-swatch--off" />{props.t('steps.offPeak')}</span>
        {anyUnattributed && <span><i className="dsu-swatch dsu-swatch--other" />{props.t('band.other')}</span>}
      </div>
      {first !== undefined && last !== undefined && first.day !== last.day && (
        <div className="dsu-bars-axis">
          <span>{first.day}</span>
          <span>{last.day}</span>
        </div>
      )}
    </div>
  )
}

/**
 * One row per billed request, newest first.
 *
 * Times are Beijing time because the price table's peak/off-peak windows are
 * defined in that zone; a local-time column would make the band column
 * unverifiable.
 *
 * @param props - request rows and the translate seat.
 * @returns the rendered table.
 */
export function StepTable(props: { steps: readonly StepDetailView[]; t: Translate }): JSX.Element {
  // The merged ledger arrives newest-first; the table renders it in that order.
  const rows = props.steps
  return (
    <div className="dsu-steps-wrap">
      <table className="dsu-steps">
        <thead>
          <tr>
            <th>{props.t('steps.time')}</th>
            <th>{props.t('steps.band')}</th>
            <th>{props.t('steps.agent')}</th>
            <th>{props.t('steps.index')}</th>
            <th>{props.t('steps.model')}</th>
            <th className="dsu-num">{props.t('steps.input')}</th>
            <th className="dsu-num">{props.t('steps.cacheRead')}</th>
            <th className="dsu-num">{props.t('steps.output')}</th>
            <th className="dsu-num">{props.t('steps.cost')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(step => (
            <tr key={`${String(step.turn)}-${String(step.step)}-${String(step.at)}`}>
              <td className="dsu-step-time">{formatBeijingTime(step.at)}</td>
              <td>
                <span className="dsu-band" data-band={step.band}>
                  {props.t(step.band === 'peak' ? 'steps.peak' : 'steps.offPeak')}
                </span>
              </td>
              <td className="dsu-num">
                {step.agentIndex === null ? props.t('steps.root') : `#${String(step.agentIndex)}`}
              </td>
              <td className="dsu-num">{step.turn}.{step.step}</td>
              <td className="dsu-step-model">{step.model === '' ? '—' : step.model}</td>
              <td className="dsu-num">{formatTokens(step.uncachedInputTokens)}</td>
              <td className="dsu-num">{formatTokens(step.cacheReadTokens)}</td>
              <td className="dsu-num">{formatTokens(step.outputTokens)}</td>
              <td className="dsu-num">
                {step.cost === null ? '—' : formatMoneyRange(step.cost.amountMicros, undefined, step.cost.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Render one peak/off-peak proportion.
 *
 * @param share - band split.
 * @param t - translate seat.
 * @param basis - 'tokens' or 'requests'.
 * @returns e.g. `峰 32% · 谷 68%`, or an em dash without data.
 */
export function bandShareText(share: BandShareView, t: Translate, basis: 'tokens' | 'requests'): string {
  const ratio = basis === 'tokens' ? peakTokenShare(share) : peakRequestShare(share)
  if (ratio === null) return '—'
  return `${t('steps.peak')} ${formatPercent(ratio)} · ${t('steps.offPeak')} ${formatPercent(1 - ratio)}`
}

/**
 * One row per direct child conversation, largest token total first.
 *
 * The columns mirror the history page's per-conversation figures so a root
 * agent can attribute its delegated spend without leaving the panel.
 *
 * @param props - child rows and the translate seat.
 * @returns the rendered table.
 */
export function ChildAgentsTable(props: { agents: readonly ChildAgentView[]; t: Translate }): JSX.Element {
  return (
    <div className="dsu-steps-wrap">
      <table className="dsu-steps">
        <thead>
          <tr>
            <th>{props.t('agents.child')}</th>
            <th className="dsu-num">{props.t('agents.requests')}</th>
            <th className="dsu-num">{props.t('agents.tokens')}</th>
            <th className="dsu-num">{props.t('agents.cache')}</th>
            <th className="dsu-num">{props.t('agents.cost')}</th>
          </tr>
        </thead>
        <tbody>
          {props.agents.map(agent => (
            <tr key={agent.id}>
              <td className="dsu-agent-title" title={agent.title}>
                <span className="dsu-agent-index">{`#${String(agent.index)}`}</span>
                {agent.running && (
                  <span
                    className="dsu-agent-running"
                    role="status"
                    aria-label={props.t('agent.running')}
                    title={props.t('agent.running')}
                  />
                )}
                {agent.title}
              </td>
              <td className="dsu-num">{formatCount(agent.requests)}</td>
              <td className="dsu-num">{formatTokenCount(agent.totalTokens)}</td>
              <td className="dsu-num">
                {agent.cacheRate === null ? '—' : formatPercent(agent.cacheRate)}
              </td>
              <td className="dsu-num">
                {agent.cost === null
                  ? '—'
                  : formatMoneyRange(agent.cost.amountMicros, agent.cost.amountMicrosMax, agent.cost.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Inline notice inside a panel body.
 *
 * @param props - notice content and tone.
 * @returns the rendered notice.
 */
export function InlineMessage(props: { children: ReactNode; tone?: 'muted' | 'warn' }): JSX.Element {
  return (
    <div className="dsu-inline" data-tone={props.tone ?? 'muted'} role="note">
      {props.children}
    </div>
  )
}
