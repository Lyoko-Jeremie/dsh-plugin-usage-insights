/**
 * Presentational building blocks shared by the two usage panels.
 *
 * Every component is a pure function of its props: the panels receive Host
 * projections and this module only lays figures out. Colour and typography come
 * from the Harness alias tokens declared in `styles.ts`, never from literal
 * values, so light and dark themes stay readable.
 */
import type { JSX, ReactNode } from 'react'
import type { DayTotal, Translate } from './contract'
import { formatTokens } from '../lib/format'
import { css } from './styles'

/** Clamp a 0–1 ratio and render it as a percentage width. */
function widthOf(ratio: number): string {
  const clamped = Math.min(1, Math.max(0, ratio))
  return `${clamped * 100}%`
}

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
 * Horizontal fill bar for one ratio.
 *
 * @param props - ratio in [0, 1] or null for an unknown value, and a tone.
 * @returns the rendered bar.
 */
export function MeterBar(props: { ratio: number | null; tone?: 'default' | 'warn' }): JSX.Element {
  const tone = props.tone ?? 'default'
  return (
    <div className="dsu-meter" data-tone={tone}>
      {props.ratio !== null && <div className="dsu-meter-value" style={{ width: widthOf(props.ratio) }} />}
    </div>
  )
}

/**
 * Circular occupancy indicator with its own caption.
 *
 * @param props - ratio in [0, 1] or null for an unknown value, and centre label.
 * @returns the rendered ring.
 */
export function Ring(props: { ratio: number | null; label: string }): JSX.Element {
  const radius = 16
  const circumference = 2 * Math.PI * radius
  const clamped = props.ratio === null ? null : Math.min(1, Math.max(0, props.ratio))
  return (
    <svg className="dsu-ring" viewBox="0 0 40 40" role="img" aria-label={props.label}>
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
              title={`${day.day} · ${formatTokens(day.totalTokens)}`}
            />
          )
        })}
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
