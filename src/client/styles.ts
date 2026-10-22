/**
 * Stylesheet of the usage panels.
 *
 * Selectors are namespaced with `dsu-` so the sheet cannot collide with other
 * Client plugins. Every colour is a Harness semantic alias token, which keeps
 * the panels readable in both light and dark themes; widths are fluid so the
 * panels fit a narrow right sidebar without horizontal scrolling.
 */
export const css = `
.dsu-root {
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  /* The tab body clips its child; the panel owns its own scroll so tall
     content stays reachable instead of being cut at the pane edge. */
  height: 100%;
  max-height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-border-l2) transparent;
  padding: 12px 12px 16px;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.dsu-root *,
.dsu-root *::before,
.dsu-root *::after {
  box-sizing: border-box;
}

.dsu-root::-webkit-scrollbar {
  width: 8px;
}

.dsu-root::-webkit-scrollbar-track {
  background: transparent;
}

.dsu-root::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: var(--dsw-alias-border-l2);
}

.dsu-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.dsu-head-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
}

.dsu-agent-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.dsu-agent-badge {
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 16px;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
}

.dsu-agent-badge[data-kind='subagent'] {
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
}

.dsu-agent-note {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

.dsu-agent-details {
  padding-top: 6px;
}

.dsu-agent-title {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsu-agent-index {
  margin-right: 6px;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.dsu-agent-running {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 5px;
  border-radius: 50%;
  vertical-align: middle;
  background: var(--dsw-alias-brand-primary);
}

.dsu-head-value {
  font-size: 26px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.dsu-head-caption {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}

.dsu-head-side {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
  flex: 0 0 auto;
}

.dsu-ring-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.dsu-ring--band .dsu-ring-track {
  stroke: var(--dsw-alias-state-success-primary);
}

.dsu-ring--band .dsu-ring-value {
  stroke: var(--dsw-alias-state-warn-primary);
}

.dsu-head-side-caption {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

.dsu-cost {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 2px 6px;
  min-width: 0;
}

.dsu-cost-label {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}

.dsu-cost-amount {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.dsu-cost-note {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

.dsu-running {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
}

.dsu-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-brand-primary);
  flex: 0 0 auto;
}

.dsu-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  min-width: 0;
}

.dsu-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.dsu-section-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
}

.dsu-section-aside {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.dsu-section-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.dsu-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(82px, 1fr));
  gap: 8px;
}

.dsu-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1);
}

.dsu-stat-label {
  font-size: 11px;
  line-height: 1.35;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}

.dsu-stat-value {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.dsu-stat-hint {
  font-size: 11px;
  line-height: 1.35;
  color: var(--dsw-alias-label-tertiary);
}

.dsu-hits {
  display: flex;
  flex-direction: column;
}

.dsu-hit {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 4px 0;
}

.dsu-hit-label {
  flex: 0 0 auto;
  min-width: 84px;
  color: var(--dsw-alias-label-secondary);
}

.dsu-hit-track {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
}

.dsu-hit-grid {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--dsw-alias-bg-layer-1);
}

.dsu-hit--ruler {
  padding-bottom: 0;
}

.dsu-hit-track--ruler {
  height: 14px;
  overflow: visible;
  background: transparent;
}

.dsu-hit-tick {
  position: absolute;
  bottom: 0;
  transform: translateX(-50%);
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.dsu-hit-fill {
  height: 100%;
  border-radius: 999px;
}

.dsu-hit-fill[data-level='good'] {
  background: var(--dsw-alias-state-success-primary);
}

.dsu-hit-fill[data-level='warn'] {
  background: var(--dsw-alias-state-warn-primary);
}

.dsu-hit-fill[data-level='bad'] {
  background: var(--dsw-alias-state-error-primary);
}

.dsu-hit-value {
  flex: 0 0 auto;
  min-width: 46px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.dsu-hit-value[data-level='good'] {
  color: var(--dsw-alias-state-success-primary);
}

.dsu-hit-value[data-level='warn'] {
  color: var(--dsw-alias-state-warn-label);
}

.dsu-hit-value[data-level='bad'] {
  color: var(--dsw-alias-state-error-primary);
}

.dsu-hit-value[data-level='none'] {
  color: var(--dsw-alias-label-tertiary);
}

.dsu-rows {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.dsu-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  padding: 3px 0;
}

.dsu-row-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.dsu-row-label {
  color: var(--dsw-alias-label-secondary);
}

.dsu-row-hint {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

.dsu-row-value {
  flex: 0 0 auto;
  max-width: 65%;
  text-align: right;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.dsu-progress {
  position: relative;
  width: 100%;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
}

.dsu-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--dsw-alias-brand-primary);
}

.dsu-progress-marker,
.dsu-compose-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-1px);
  border-radius: 1px;
  background: var(--dsw-alias-state-warn-label);
}

.dsu-ctx-threshold {
  color: var(--dsw-alias-state-warn-label);
  font-weight: 500;
}

.dsu-compose {
  position: relative;
  display: flex;
  width: 100%;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
}

.dsu-compose-fill {
  display: flex;
  height: 100%;
  overflow: hidden;
  border-radius: 999px;
}

.dsu-compose-seg {
  height: 100%;
  min-width: 2px;
}

.dsu-compose-seg[data-part='system'] {
  background: var(--dsw-alias-state-business-primary);
}

.dsu-compose-seg[data-part='tools'] {
  background: var(--dsw-alias-state-warn-primary);
}

.dsu-compose-seg[data-part='messages'] {
  background: var(--dsw-alias-state-success-primary);
}

.dsu-compose-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

.dsu-compose-legend > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dsu-ring {
  display: block;
  width: 56px;
  height: 56px;
  flex: 0 0 auto;
}

.dsu-ring-track {
  fill: none;
  stroke: var(--dsw-alias-border-l2);
  stroke-width: 3;
}

.dsu-ring-value {
  fill: none;
  stroke: var(--dsw-alias-brand-primary);
  stroke-width: 3;
  stroke-linecap: round;
}

.dsu-ring-label {
  fill: var(--dsw-alias-label-primary);
  font-size: 9px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.dsu-ctx {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.dsu-ctx-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.dsu-ctx-used {
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.dsu-ctx-sep {
  color: var(--dsw-alias-label-tertiary);
}

.dsu-ctx-pct {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

.dsu-note {
  font-size: 11px;
  line-height: 1.4;
  color: var(--dsw-alias-label-tertiary);
}

.dsu-inline {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 1.45;
}

.dsu-inline[data-tone='warn'] {
  border-color: var(--dsw-alias-state-warn-primary);
  color: var(--dsw-alias-label-primary);
}

.dsu-inline-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.dsu-btn {
  appearance: none;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  white-space: nowrap;
}

.dsu-btn:hover:not(:disabled) {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
}

.dsu-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

.dsu-btn:disabled {
  color: var(--dsw-alias-label-tertiary);
  cursor: default;
}

.dsu-range {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1);
}

.dsu-range-btn {
  flex: 1 1 0;
  min-width: 0;
  appearance: none;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  line-height: 1.3;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dsu-range-btn:hover {
  color: var(--dsw-alias-label-primary);
}

.dsu-range-btn[aria-pressed='true'] {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-brand-primary);
  font-weight: 600;
}

.dsu-range-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

.dsu-bars-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.dsu-bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 64px;
  min-width: 0;
}

.dsu-bar {
  flex: 1 1 0;
  min-width: 0;
  min-height: 2px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  overflow: hidden;
  border-radius: 2px 2px 0 0;
}

.dsu-bar-seg {
  display: block;
  flex-basis: 0;
  min-height: 0;
}

.dsu-bar-seg--peak {
  background: var(--dsw-alias-state-warn-primary);
}

.dsu-bar-seg--off {
  background: var(--dsw-alias-state-success-primary);
}

.dsu-bar-seg--other {
  background: var(--dsw-alias-label-tertiary);
  opacity: 0.5;
}

.dsu-bar--empty {
  background: var(--dsw-alias-border-l2);
}

.dsu-bars-legend {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

.dsu-bars-legend > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dsu-swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.dsu-swatch--peak {
  background: var(--dsw-alias-state-warn-primary);
}

.dsu-swatch--off {
  background: var(--dsw-alias-state-success-primary);
}

.dsu-swatch--other {
  background: var(--dsw-alias-label-tertiary);
  opacity: 0.5;
}

.dsu-swatch[data-part='system'] {
  background: var(--dsw-alias-state-business-primary);
}

.dsu-swatch[data-part='tools'] {
  background: var(--dsw-alias-state-warn-primary);
}

.dsu-swatch[data-part='messages'] {
  background: var(--dsw-alias-state-success-primary);
}

.dsu-bars-axis {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

.dsu-steps-details {
  padding-top: 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  min-width: 0;
}

.dsu-steps-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  list-style: none;
  user-select: none;
  min-width: 0;
}

.dsu-steps-summary::-webkit-details-marker {
  display: none;
}

.dsu-steps-summary:hover .dsu-section-title {
  color: var(--dsw-alias-label-primary);
}

.dsu-steps-summary:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
  border-radius: 4px;
}

.dsu-chevron {
  width: 0;
  height: 0;
  border-left: 4px solid var(--dsw-alias-label-tertiary);
  border-top: 3.5px solid transparent;
  border-bottom: 3.5px solid transparent;
  transition: transform 0.12s ease;
}

.dsu-steps-details[open] .dsu-chevron {
  transform: rotate(90deg);
}

.dsu-steps-meta {
  margin-left: auto;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dsu-steps-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  min-width: 0;
}

.dsu-steps-toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dsu-steps-wrap {
  width: 100%;
  min-width: 0;
  overflow-x: auto;
}

.dsu-steps {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
}

.dsu-steps th {
  position: sticky;
  top: 0;
  padding: 4px 6px;
  text-align: left;
  font-weight: 500;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-layer-1);
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.dsu-steps td {
  padding: 3px 6px;
  white-space: nowrap;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.dsu-steps tr:last-child td {
  border-bottom: 0;
}

.dsu-steps .dsu-num {
  text-align: right;
}

.dsu-step-time {
  color: var(--dsw-alias-label-tertiary);
}

.dsu-step-model {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dsu-band {
  display: inline-block;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 15px;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
}

.dsu-band[data-band='peak'] {
  color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
`
