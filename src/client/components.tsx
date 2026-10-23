/**
 * Presentational building blocks shared by the two usage panels.
 *
 * Every component is a pure function of its props: the panels receive Host
 * projections and this module only lays figures out. Colour and typography come
 * from the Harness alias tokens declared in `styles.ts`, never from literal
 * values, so light and dark themes stay readable.
 */
import { useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode, RefObject } from 'react'
import type { BandShareView, ChildAgentView, DayTotal, StepDetailView, Translate } from './contract'
import { peakRequestShare, peakTokenShare } from '../lib/band-share.ts'
import { divisionsForWidth, hitBarRatio, hitLevel, hitTicks, hitTickLabel } from '../lib/hit-scale.ts'
import {
  currencySymbol, formatAmountFixed, formatBeijingTime, formatCount, formatMoneyRange, formatPercent,
  formatPercentFixed, formatTokenCount, formatTokens,
} from '../lib/format'
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
export function Stat(props: { label: string; value: string; hint?: string; title?: string }): JSX.Element {
  return (
    <div className="dsu-stat">
      <div className="dsu-stat-label">{props.label}</div>
      <div className="dsu-stat-value" title={props.title}>{props.value}</div>
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
export function Row(props: { label: string; value: ReactNode; hint?: string; title?: string }): JSX.Element {
  return (
    <div className="dsu-row">
      <div className="dsu-row-main">
        <span className="dsu-row-label">{props.label}</span>
        {props.hint !== undefined && <span className="dsu-row-hint">{props.hint}</span>}
      </div>
      <span className="dsu-row-value" title={props.title}>{props.value}</span>
    </div>
  )
}

/**
 * Single-value progress bar with an optional threshold marker.
 *
 * @param props - ratio in [0, 1] or null, plus an optional marker position.
 * @returns the rendered bar.
 */
export function ProgressBar(props: { ratio: number | null; marker?: number | null }): JSX.Element {
  const ratio = props.ratio === null ? 0 : Math.min(1, Math.max(0, props.ratio))
  const marker = props.marker === null || props.marker === undefined
    ? null
    : Math.min(1, Math.max(0, props.marker))
  return (
    <div className="dsu-progress" role="img" aria-label={formatPercent(ratio)}>
      <div className="dsu-progress-fill" style={{ width: `${ratio * 100}%` }} />
      {marker !== null && <span className="dsu-progress-marker" style={{ left: `${marker * 100}%` }} />}
    </div>
  )
}

/** Segment count used before the track has been measured. */
const DEFAULT_HIT_DIVISIONS = 8

/**
 * Segment count for the cache-hit ruler, measured from the track.
 *
 * The ruler divides the track into equal lengths, so the count has to follow
 * the width actually available: too many segments and the labels collide, too
 * few and the bar loses its references. The hook measures the track and
 * re-halves or re-doubles the count whenever the panel is resized.
 *
 * @returns the current segment count and the ref to attach to the ruler track.
 */
export function useHitDivisions(): { divisions: number; trackRef: RefObject<HTMLDivElement | null> } {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [divisions, setDivisions] = useState(DEFAULT_HIT_DIVISIONS)
  useEffect(() => {
    const track = trackRef.current
    if (track === null || typeof ResizeObserver === 'undefined') return undefined
    const update = (): void => {
      setDivisions(divisionsForWidth(track.clientWidth))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(track)
    return () => {
      observer.disconnect()
    }
  }, [])
  return { divisions, trackRef }
}

/**
 * Cache-hit bar with its percentage.
 *
 * The fill uses the non-linear scale from `hit-scale` so rates above 90% keep
 * their differences visible; the percentage carries the status colour. Reference
 * ticks cut into the fill sit on the same equal divisions as the ruler, so a
 * length can be read back against its labels.
 *
 * @param props - segment count, row label and the hit ratio, or null without usage.
 * @returns the rendered bar.
 */
export function HitBar(props: { divisions: number; label: string; ratio: number | null }): JSX.Element {
  const level = hitLevel(props.ratio)
  const width = props.ratio === null ? 0 : hitBarRatio(props.ratio)
  return (
    <div className="dsu-hit">
      <span className="dsu-hit-label">{props.label}</span>
      <div className="dsu-hit-track">
        {hitTicks(props.divisions).filter(tick => tick.width < 1).map(tick => (
          <span key={tick.width} className="dsu-hit-grid" style={{ left: `${tick.width * 100}%` }} />
        ))}
        {props.ratio !== null && (
          <div className="dsu-hit-fill" data-level={level} style={{ width: `${width * 100}%` }} />
        )}
      </div>
      <span className="dsu-hit-value" data-level={level}>
        {props.ratio === null ? '—' : formatPercentFixed(props.ratio, 3)}
      </span>
    </div>
  )
}

/**
 * Ruler shared by the cache-hit bars.
 *
 * Sits above them with the same label/track/value structure, so every label
 * lands exactly above the line cut into each bar. Labels divide the track into
 * equal lengths and print the rate each division displays; the segment count
 * comes from the measured track width.
 *
 * @param props - segment count and the ref of the measured track.
 * @returns the rendered ruler row.
 */
export function HitRuler(props: { divisions: number; trackRef: RefObject<HTMLDivElement | null> }): JSX.Element {
  return (
    <div className="dsu-hit dsu-hit--ruler" aria-hidden="true">
      <span className="dsu-hit-label" />
      <div className="dsu-hit-track dsu-hit-track--ruler" ref={props.trackRef}>
        {hitTicks(props.divisions).map(tick => (
          <span key={tick.width} className="dsu-hit-tick" style={{ left: `${tick.width * 100}%` }}>
            {hitTickLabel(tick.ratio)}
          </span>
        ))}
      </div>
      <span className="dsu-hit-value" />
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
 * Occupied part of the context window, split into the composition colours.
 *
 * One bar carries both facts: its width is the occupancy ratio and its fill is
 * the system / tools / messages split, so the reader sees how much of the
 * window is used and what the used part consists of at a glance. An optional
 * marker shows the automatic-compaction pressure point.
 *
 * @param props - occupancy ratio, composition segments and an optional marker.
 * @returns the rendered bar.
 */
export function CompositionProgress(props: {
  ratio: number | null
  segments: readonly CompositionSegment[]
  marker?: number | null
}): JSX.Element {
  const ratio = props.ratio === null ? 0 : Math.min(1, Math.max(0, props.ratio))
  const marker = props.marker === null || props.marker === undefined
    ? null
    : Math.min(1, Math.max(0, props.marker))
  const description = props.segments
    .map(segment => `${segment.label} ${formatTokens(segment.tokens)}`)
    .join(' · ')
  return (
    <div className="dsu-compose dsu-compose--progress" role="img" aria-label={description}>
      <div className="dsu-compose-fill" style={{ width: `${ratio * 100}%` }}>
        {props.segments.map(segment => segment.tokens > 0 && (
          <span
            key={segment.part}
            className="dsu-compose-seg"
            data-part={segment.part}
            style={{ flexGrow: segment.tokens }}
          />
        ))}
      </div>
      {marker !== null && <span className="dsu-compose-marker" style={{ left: `${marker * 100}%` }} />}
    </div>
  )
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
              title={`${day.day} · ${formatTokens(day.totalTokens)} · ${props.t('steps.peak')} ${formatTokens(day.peakTokens)} · ${props.t('steps.offPeak')} ${formatTokens(day.offPeakTokens)}`}
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
  // The currency is a property of the price table, so one row states it for the
  // whole column and the cells keep digits only.
  const currency = rows.find(step => step.cost !== null)?.cost?.currency ?? null
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
            <th className="dsu-num">
              {currency === null
                ? props.t('steps.cost')
                : `${props.t('steps.cost')} (${currencySymbol(currency)})`}
            </th>
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
              <td className="dsu-num">{formatTokenCount(step.uncachedInputTokens)}</td>
              <td className="dsu-num">{formatTokenCount(step.cacheReadTokens)}</td>
              <td className="dsu-num">{formatTokenCount(step.outputTokens)}</td>
              <td className="dsu-num">
                {step.cost === null ? '—' : formatAmountFixed(step.cost.amountMicros, 6)}
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
