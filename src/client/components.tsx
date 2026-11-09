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
import type {
  AmountBreakdownView, AmountSliceKey, BandShareView, ChildAgentView, CostBandShare, DayTotal,
  StepDetailView, Translate,
} from './contract'
import { peakRequestShare, peakTokenShare } from '../lib/band-share.ts'
import { divisionsForWidth, hitBarRatio, hitLevel, hitRatioAtWidth, hitTicks, hitTickLabel } from '../lib/hit-scale.ts'
import { contextBarRatio } from '../lib/context-scale.ts'
import { hitSegmentParts } from '../lib/trend.ts'
import type { StepTrendPoint } from '../lib/trend.ts'
import {
  currencySymbol, formatAmountFixed, formatBeijingTime, formatCount, formatMoney, formatMoneyRange,
  formatPercent, formatPercentFixed, formatTokenCount, formatTokens,
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
 * @param props - section title, optional right-aligned aside, body content and
 * whether the title doubles as a collapse toggle.
 * @returns the rendered section.
 */
export function Section(props: {
  title: string
  aside?: ReactNode
  children?: ReactNode
  collapsible?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(true)
  const collapsible = props.collapsible === true
  return (
    <section className="dsu-section">
      <div className="dsu-section-head">
        {collapsible ? (
          <button
            type="button"
            className="dsu-section-toggle"
            aria-expanded={open}
            onClick={() => setOpen(value => !value)}
          >
            <span className="dsu-chevron" aria-hidden="true" />
            <span className="dsu-section-title">{props.title}</span>
          </button>
        ) : (
          <div className="dsu-section-title">{props.title}</div>
        )}
        {props.aside !== undefined && <div className="dsu-section-aside">{props.aside}</div>}
      </div>
      {props.children !== undefined && (!collapsible || open) && (
        <div className="dsu-section-body">{props.children}</div>
      )}
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
 * Billed-amount bar for one cache-hit scope.
 *
 * The track splits the scope's amount by token purpose; each segment takes its
 * share of the total, so the bar reads as one picture. The value on the right
 * is the scope's amount, a range when the price table varies by band.
 *
 * @param props - row label, the composition or null without a price, part names
 * and the note shown when part of the tokens stayed unpriced.
 * @returns the rendered amount row.
 */
export function AmountBar(props: {
  label: string
  amount: AmountBreakdownView | null
  labels: Record<AmountSliceKey, string>
  partialLabel: string
}): JSX.Element {
  const amount = props.amount
  const description = amount === null
    ? props.label
    : amount.slices
      .filter(slice => slice.micros > 0)
      .map(slice => `${props.labels[slice.key]} ${formatMoneyRange(slice.micros, slice.microsMax, amount.currency)}`)
      .join(' · ')
  return (
    <div className="dsu-hit dsu-hit--amount">
      <span className="dsu-hit-label">{props.label}</span>
      <div className="dsu-hit-track dsu-amount-track" role="img" aria-label={description}>
        {amount !== null && amount.slices.map(slice => slice.micros > 0 && (
          <span
            key={slice.key}
            className="dsu-amount-seg"
            data-part={slice.key}
            style={{ flexGrow: slice.micros }}
          />
        ))}
      </div>
      <span
        className="dsu-hit-value dsu-amount-value"
        title={amount !== null && !amount.complete ? props.partialLabel : undefined}
      >
        {amount === null
          ? '—'
          : `${formatMoneyRange(amount.micros, amount.microsMax, amount.currency)}${amount.complete ? '' : '*'}`}
      </span>
    </div>
  )
}

/**
 * Colour legend of the billed-amount bars.
 *
 * @param props - the parts the cumulative composition actually carries, and their names.
 * @returns the rendered legend.
 */
export function AmountLegend(props: {
  keys: readonly AmountSliceKey[]
  labels: Record<AmountSliceKey, string>
}): JSX.Element {
  if (props.keys.length === 0) return <></>
  return (
    <div className="dsu-compose-legend dsu-amount-legend">
      {props.keys.map(key => (
        <span key={key}>
          <i className="dsu-swatch" data-part={key} />
          {props.labels[key]}
        </span>
      ))}
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
 * One column per calendar day, scaled to the largest day in the range.
 *
 * The bar carries the day's cost, split by the band each request ran in, so it
 * stacks the same two colours as the daily token chart above it.
 *
 * @param props - ascending day totals, the price table's currency and the translate seat.
 * @returns the rendered cost chart.
 */
export function DailyCostBars(props: {
  days: readonly DayTotal[]
  currency: string
  t: Translate
}): JSX.Element {
  const days = props.days
  if (days.length === 0) {
    return <InlineMessage>{props.t('history.empty')}</InlineMessage>
  }
  let max = 0
  for (const day of days) {
    const amount = day.costMicros ?? 0
    if (amount > max) max = amount
  }
  const first = days[0]
  const last = days[days.length - 1]
  return (
    <div className="dsu-bars-wrap">
      <div className="dsu-bars" role="img" aria-label={props.t('history.dailyCost')}>
        {days.map((day) => {
          const amount = day.costMicros ?? 0
          const height = max > 0 ? (amount / max) * 100 : 0
          const empty = height <= 0
          return (
            <div
              key={day.day}
              className={empty ? 'dsu-bar dsu-bar--empty' : 'dsu-bar'}
              style={{ height: empty ? '2px' : `${height}%` }}
              title={dayCostTitle(day, props.currency, props.t)}
            >
              {!empty && (
                <>
                  {day.offPeakCostMicros > 0 && (
                    <span className="dsu-bar-seg dsu-bar-seg--off" style={{ flexGrow: day.offPeakCostMicros }} />
                  )}
                  {day.peakCostMicros > 0 && (
                    <span className="dsu-bar-seg dsu-bar-seg--peak" style={{ flexGrow: day.peakCostMicros }} />
                  )}
                  {day.otherCostMicros > 0 && (
                    <span className="dsu-bar-seg dsu-bar-seg--other" style={{ flexGrow: day.otherCostMicros }} />
                  )}
                </>
              )}
            </div>
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
 * Compose one day's cost tooltip.
 *
 * @param day - one day total.
 * @param currency - ISO 4217 code of the price table.
 * @param t - translate seat.
 * @returns the hover text, e.g. `2026-10-22 · ¥12.35 · Peak ¥9.10`.
 */
function dayCostTitle(day: DayTotal, currency: string, t: Translate): string {
  const parts = [day.day]
  if (day.costMicros === null) {
    parts.push(t('cost.unpriced'))
    return parts.join(' · ')
  }
  parts.push(formatMoneyRange(day.costMicros, day.costMicrosMax, currency))
  if (day.peakCostMicros > 0) parts.push(`${t('steps.peak')} ${formatMoney(day.peakCostMicros, currency)}`)
  if (day.offPeakCostMicros > 0) parts.push(`${t('steps.offPeak')} ${formatMoney(day.offPeakCostMicros, currency)}`)
  if (day.otherCostMicros > 0) parts.push(`${t('band.other')} ${formatMoney(day.otherCostMicros, currency)}`)
  if (day.costUnpriced) parts.push(t('cost.partial'))
  return parts.join(' · ')
}

/**
 * Cache-hit rate of one request.
 *
 * The rate reads cache reads over billed input, the same ratio the cache-hit
 * section shows, and keeps three decimals so neighbouring requests stay
 * comparable.
 *
 * @param step - one request row.
 * @returns e.g. `99.618%`, or an em dash when the request billed no input.
 */
function stepCacheText(step: StepDetailView): string {
  const billed = step.uncachedInputTokens + step.cacheReadTokens + step.cacheWriteTokens
  return billed > 0 ? formatPercentFixed(step.cacheReadTokens / billed, 3) : '—'
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
            <th className="dsu-num">{props.t('steps.cacheHit')}</th>
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
              <td className="dsu-num">{stepCacheText(step)}</td>
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
 * Describe one conversation's amount split by billing band.
 *
 * The same requests cost different amounts in the two bands, so the ring can
 * differ from the token ring beside it; the tooltip spells out both amounts.
 *
 * @param share - amount split, or null without per-band pricing.
 * @param currency - ISO 4217 code of the price table.
 * @param t - translate seat.
 * @returns e.g. `峰 ¥12.34 · 谷 ¥5.67`, or an em dash without data.
 */
export function costBandShareText(
  share: CostBandShare | null,
  currency: string,
  t: Translate,
): string {
  if (share === null) return '—'
  return `${t('steps.peak')} ${formatMoney(share.peakMicros, currency)} · `
    + `${t('steps.offPeak')} ${formatMoney(share.offPeakMicros, currency)}`
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

/** Height of the trend plot, in CSS pixels. */
const TREND_HEIGHT = 181
/** Horizontal breathing room inside the plot. */
const TREND_PAD_X = 2
/** Vertical breathing room inside the plot. */
const TREND_PAD_Y = 8
/** Width reserved for the linear context labels on the left. */
const TREND_AXIS_LEFT = 26
/** Width reserved for the logarithmic cache-hit labels on the right. */
const TREND_AXIS_RIGHT = 26
/** Plot width used until the container has been measured. */
const DEFAULT_TREND_WIDTH = 300
/** Occupancy ratios that get a grid line and a left-axis label. */
const CONTEXT_TICKS = [0, 0.25, 0.5, 0.75, 1] as const

/**
 * Measure the width the trend plot can use.
 *
 * The plot is an SVG with a viewBox in CSS pixels rather than a stretched
 * viewBox, so the stroke keeps its thickness and each hover column stays over
 * the request it describes.
 *
 * @returns the measured width and the ref to attach to the plot container.
 */
function useTrendWidth(): { width: number; chartRef: RefObject<HTMLDivElement | null> } {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(DEFAULT_TREND_WIDTH)
  useEffect(() => {
    const chart = chartRef.current
    if (chart === null || typeof ResizeObserver === 'undefined') return undefined
    const update = (): void => {
      if (chart.clientWidth > 0) setWidth(chart.clientWidth)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(chart)
    return () => {
      observer.disconnect()
    }
  }, [])
  return { width, chartRef }
}

/**
 * Build one series path, breaking at samples that carry no ratio.
 *
 * @param points - ascending trend points.
 * @param pick - ratio accessor of the series.
 * @param xAt - horizontal position of a point index.
 * @param yAt - vertical position of a ratio.
 * @returns an SVG path, or an empty string without samples.
 */
function trendPath(
  points: readonly StepTrendPoint[],
  pick: (point: StepTrendPoint) => number | null,
  xAt: (index: number) => number,
  yAt: (ratio: number) => number,
): string {
  let path = ''
  let open = false
  points.forEach((point, index) => {
    const value = pick(point)
    if (value === null) {
      open = false
      return
    }
    path += `${open ? 'L' : 'M'}${xAt(index).toFixed(2)} ${yAt(value).toFixed(2)}`
    open = true
  })
  return path
}

/**
 * Status level of one cache-hit sample, or null without a ratio.
 *
 * @param ratio - cache reads over billed input, or null without usage.
 * @returns the hit level, or null when the request billed no input.
 */
function trendHitLevel(ratio: number | null): 'good' | 'warn' | 'bad' | null {
  const level = hitLevel(ratio)
  return level === 'none' ? null : level
}

/**
 * Split the cache series into drawable, colour-coded segments.
 *
 * A single path cannot change colour halfway, so each pair of adjacent
 * samples becomes its own set of lines. Each line is split again where it
 * crosses the 90% or 70% level, so a segment that runs from green through
 * yellow into red shows all three colours along its own length instead of
 * taking the worse endpoint's colour from end to end.
 *
 * @param points - ascending trend points.
 * @param pick - ratio accessor of the series.
 * @param xAt - horizontal position of a point index.
 * @param yAt - vertical position of a ratio.
 * @returns one line per adjacent pair and status band.
 */
function trendSegments(
  points: readonly StepTrendPoint[],
  pick: (point: StepTrendPoint) => number | null,
  xAt: (index: number) => number,
  yAt: (ratio: number) => number,
): Array<{ key: string; x1: number; y1: number; x2: number; y2: number; level: 'good' | 'warn' | 'bad' }> {
  const segments: Array<{
    key: string
    x1: number
    y1: number
    x2: number
    y2: number
    level: 'good' | 'warn' | 'bad'
  }> = []
  points.forEach((point, index) => {
    if (index === 0) return
    const previous = points[index - 1]
    if (previous === undefined) return
    const from = pick(previous)
    const to = pick(point)
    if (from === null || to === null) return
    const startX = xAt(index - 1)
    const endX = xAt(index)
    const startY = yAt(from)
    const endY = yAt(to)
    hitSegmentParts(from, to).forEach((part, partIndex) => {
      segments.push({
        key: `segment-${index}-${partIndex}`,
        x1: startX + (endX - startX) * part.from,
        y1: startY + (endY - startY) * part.from,
        x2: startX + (endX - startX) * part.to,
        y2: startY + (endY - startY) * part.to,
        level: part.level,
      })
    })
  })
  return segments
}

/**
 * Horizontal extent of one request's hover column.
 *
 * Columns meet halfway between neighbouring points, so the whole plot is
 * covered and the first and last requests reach the plot edges.
 *
 * @param index - point index.
 * @param count - number of points.
 * @param xAt - horizontal position of a point index.
 * @param plotLeft - left edge of the plot area.
 * @param plotRight - right edge of the plot area.
 * @returns the column origin and width.
 */
function trendHitBounds(
  index: number,
  count: number,
  xAt: (index: number) => number,
  plotLeft: number,
  plotRight: number,
): { x: number; width: number } {
  if (count <= 1) return { x: plotLeft, width: Math.max(0.5, plotRight - plotLeft) }
  const before = index === 0 ? plotLeft : (xAt(index - 1) + xAt(index)) / 2
  const after = index === count - 1 ? plotRight : (xAt(index) + xAt(index + 1)) / 2
  return { x: before, width: Math.max(0.5, after - before) }
}

/**
 * Latest non-null value of one series.
 *
 * @param points - ascending trend points.
 * @param pick - ratio accessor of the series.
 * @returns the newest ratio, or null when the series has no sample.
 */
function latestRatio(
  points: readonly StepTrendPoint[],
  pick: (point: StepTrendPoint) => number | null,
): number | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index]
    if (point === undefined) continue
    const value = pick(point)
    if (value !== null) return value
  }
  return null
}

/**
 * Two series over the request ledger: context occupancy and cache hit rate.
 *
 * The left axis is a logarithmic context occupancy, so the 0–50% band where
 * early requests move takes about three quarters of the plot. The right axis is
 * the same power scale as the cache-hit bars, where 90% already sits halfway
 * up. Two axes let one plot show both facts without hiding the spread above
 * 90%. The dashed line marks the automatic-compaction threshold on the context
 * axis. Hovering anywhere over a request lights the whole column and shows both
 * of its values in one tooltip, so the two series can be read against each other
 * at the same step. The line is broken where a request billed no input instead
 * of reading as a zero.
 *
 * @param props - ascending samples, the declared capacity, the compaction threshold and the translate seat.
 * @returns the rendered trend chart.
 */
export function StepTrendChart(props: {
  points: readonly StepTrendPoint[]
  windowTokens: number | null
  threshold: number | null
  t: Translate
}): JSX.Element {
  const t = props.t
  const points = props.points
  const { width, chartRef } = useTrendWidth()
  const [hover, setHover] = useState<number | null>(null)
  const first = points[0]
  const last = points[points.length - 1]
  if (first === undefined || last === undefined) {
    return <InlineMessage>{t('trend.empty')}</InlineMessage>
  }
  // The context axis uses its own log scale, which spreads the low end; the
  // cache axis reuses the power scale of the cache-hit bars, so a 90% hit
  // already sits halfway up the plot.
  const showAxes = width >= 200
  const plotLeft = TREND_PAD_X + (showAxes ? TREND_AXIS_LEFT : 0)
  const plotRight = width - TREND_PAD_X - (showAxes ? TREND_AXIS_RIGHT : 0)
  const plotWidth = Math.max(1, plotRight - plotLeft)
  const plotHeight = TREND_HEIGHT - TREND_PAD_Y * 2
  const xAt = (index: number): number =>
    points.length <= 1
      ? plotLeft + plotWidth / 2
      : plotLeft + (index / (points.length - 1)) * plotWidth
  const contextYAt = (ratio: number): number => TREND_PAD_Y + (1 - contextBarRatio(ratio)) * plotHeight
  const cacheYAt = (ratio: number): number => TREND_PAD_Y + (1 - hitBarRatio(ratio)) * plotHeight
  const contextPath = trendPath(points, point => point.contextRatio, xAt, contextYAt)
  const cacheSegments = trendSegments(points, point => point.cacheRatio, xAt, cacheYAt)
  const latestContext = latestRatio(points, point => point.contextRatio)
  const latestCache = latestRatio(points, point => point.cacheRatio)
  const threshold = props.threshold === null || props.threshold === undefined
    ? null
    : Math.min(1, Math.max(0, props.threshold))
  const showDots = points.length <= 60
  const hovered = hover === null ? undefined : points[hover]
  const hoverX = hover === null ? 0 : xAt(hover)
  const tipOnLeft = hover !== null && hover > (points.length - 1) / 2
  return (
    <div className="dsu-trend">
      <div className="dsu-trend-legend">
        <span className="dsu-trend-key" data-series="context">
          <i className="dsu-trend-swatch" aria-hidden="true" />
          {t('trend.context')}
          <b>{latestContext === null ? '—' : formatPercent(latestContext)}</b>
          <span className="dsu-trend-scale">{t('trend.contextScale')}</span>
        </span>
        <span className="dsu-trend-key" data-series="cache">
          <i className="dsu-trend-swatch" aria-hidden="true" />
          {t('trend.cache')}
          <b>{latestCache === null ? '—' : formatPercentFixed(latestCache, 3)}</b>
          <span className="dsu-trend-scale">{t('trend.cacheScale')}</span>
        </span>
        {threshold !== null && (
          <span className="dsu-trend-key" data-series="threshold">
            <i className="dsu-trend-swatch" aria-hidden="true" />
            {t('context.compaction')}
            <b>{formatPercent(threshold)}</b>
          </span>
        )}
      </div>
      <div
        className="dsu-trend-chart"
        ref={chartRef}
        role="img"
        aria-label={`${t('trend.context')} / ${t('trend.cache')}`}
      >
        <svg
          width={width}
          height={TREND_HEIGHT}
          viewBox={`0 0 ${width} ${TREND_HEIGHT}`}
          aria-hidden="true"
          onPointerLeave={() => setHover(null)}
        >
          {points.map((point, index) => {
            const bounds = trendHitBounds(index, points.length, xAt, plotLeft, plotRight)
            return (
              <rect
                key={`hit-${point.at}-${point.turn}-${point.step}`}
                className="dsu-trend-hit"
                x={bounds.x}
                y={0}
                width={bounds.width}
                height={TREND_HEIGHT}
                onPointerMove={() => setHover(index)}
                onPointerLeave={() => setHover(null)}
              />
            )
          })}
          {CONTEXT_TICKS.map(ratio => (
            <line
              key={ratio}
              className="dsu-trend-grid"
              x1={plotLeft}
              x2={plotRight}
              y1={contextYAt(ratio)}
              y2={contextYAt(ratio)}
            />
          ))}
          {threshold !== null && (
            <line
              className="dsu-trend-threshold"
              x1={plotLeft}
              x2={plotRight}
              y1={contextYAt(threshold)}
              y2={contextYAt(threshold)}
            />
          )}
          {showAxes && CONTEXT_TICKS.map(ratio => (
            <text
              key={`context-${ratio}`}
              className="dsu-trend-tick"
              x={TREND_PAD_X}
              y={contextYAt(ratio) + 3}
              textAnchor="start"
            >
              {formatPercent(ratio)}
            </text>
          ))}
          {showAxes && ([0, 0.5, 1] as const).map(position => (
            <text
              key={`cache-${position}`}
              className="dsu-trend-tick"
              data-axis="cache"
              x={width - TREND_PAD_X}
              y={TREND_PAD_Y + (1 - position) * plotHeight + 3}
              textAnchor="end"
            >
              {hitTickLabel(hitRatioAtWidth(position))}
            </text>
          ))}
          {contextPath !== '' && <path className="dsu-trend-line" data-series="context" d={contextPath} />}
          {cacheSegments.map(segment => (
            <line
              key={segment.key}
              className="dsu-trend-line"
              data-series="cache"
              data-level={segment.level}
              x1={segment.x1}
              y1={segment.y1}
              x2={segment.x2}
              y2={segment.y2}
            />
          ))}
          {showDots && points.map((point, index) => (
            <g key={`dot-${point.at}-${point.turn}-${point.step}`}>
              {point.contextRatio !== null && (
                <circle
                  className="dsu-trend-dot"
                  data-series="context"
                  cx={xAt(index)}
                  cy={contextYAt(point.contextRatio)}
                  r={1.7}
                />
              )}
              {point.cacheRatio !== null && (
                <circle
                  className="dsu-trend-dot"
                  data-series="cache"
                  data-level={trendHitLevel(point.cacheRatio) ?? 'normal'}
                  cx={xAt(index)}
                  cy={cacheYAt(point.cacheRatio)}
                  r={1.7}
                />
              )}
            </g>
          ))}
          {hovered !== undefined && (
            <line
              className="dsu-trend-crosshair"
              x1={hoverX}
              x2={hoverX}
              y1={TREND_PAD_Y}
              y2={TREND_PAD_Y + plotHeight}
            />
          )}
          {hovered !== undefined && hovered.contextRatio !== null && (
            <circle
              className="dsu-trend-cursor"
              data-series="context"
              cx={hoverX}
              cy={contextYAt(hovered.contextRatio)}
              r={3.2}
            />
          )}
          {hovered !== undefined && hovered.cacheRatio !== null && (
            <circle
              className="dsu-trend-cursor"
              data-series="cache"
              data-level={trendHitLevel(hovered.cacheRatio) ?? 'normal'}
              cx={hoverX}
              cy={cacheYAt(hovered.cacheRatio)}
              r={3.2}
            />
          )}
        </svg>
        {hovered !== undefined && (
          <div
            className="dsu-trend-tip"
            style={{ left: hoverX, transform: tipOnLeft ? 'translateX(calc(-100% - 6px))' : 'translateX(6px)' }}
            role="presentation"
          >
            <div className="dsu-trend-tip-head">
              {`${formatBeijingTime(hovered.at)} · ${hovered.turn}.${hovered.step}`}
            </div>
            <div className="dsu-trend-tip-row" data-series="context">
              <i className="dsu-trend-swatch" aria-hidden="true" />
              <span>{t('trend.context')}</span>
              <b>{hovered.contextRatio === null ? '—' : formatPercent(hovered.contextRatio)}</b>
            </div>
            {hovered.contextRatio !== null && props.windowTokens !== null && (
              <div className="dsu-trend-tip-sub">
                {`${formatTokenCount(hovered.promptTokens)} / ${formatTokenCount(props.windowTokens)}`}
              </div>
            )}
            <div
              className="dsu-trend-tip-row"
              data-series="cache"
              data-level={trendHitLevel(hovered.cacheRatio) ?? 'normal'}
            >
              <i className="dsu-trend-swatch" aria-hidden="true" />
              <span>{t('trend.cache')}</span>
              <b>{hovered.cacheRatio === null ? '—' : formatPercentFixed(hovered.cacheRatio, 3)}</b>
            </div>
          </div>
        )}
      </div>
      <div className="dsu-trend-axis">
        <span>{formatBeijingTime(first.at)}</span>
        <span>{formatBeijingTime(last.at)}</span>
      </div>
      {props.windowTokens === null && <div className="dsu-note">{t('context.capacityUnknown')}</div>}
    </div>
  )
}
