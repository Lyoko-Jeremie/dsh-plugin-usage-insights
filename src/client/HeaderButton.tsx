/**
 * Header entry point for the usage page.
 *
 * The right Sidebar opens collapsed and its guide only appears after the user
 * expands the column, so the page type alone is hard to discover. This button
 * lives in the conversation header's utility strip and opens the page directly
 * (which also expands the column).
 */
import type { JSX } from 'react'
import type { Translate } from './contract'

/** Props the registration supplies: copy plus the navigation callback. */
export interface UsageHeaderButtonProps {
  t: Translate
  open: () => void
}

/** Compact icon button sized to the header's other utilities. */
const css = `
.dsu-header-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsu-header-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsu-header-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
`

/**
 * Render the header usage button.
 * @param props - translate seat and the injected open action.
 * @returns the button plus its local stylesheet.
 */
export function UsageHeaderButton({ t, open }: UsageHeaderButtonProps): JSX.Element {
  return (
    <>
      <style>{css}</style>
      <button
        type="button"
        className="dsu-header-btn"
        aria-label={t('action.openUsage')}
        title={t('action.openUsage')}
        onClick={open}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <rect x="2" y="9" width="3" height="5" rx="1" fill="currentColor" />
          <rect x="6.5" y="6" width="3" height="8" rx="1" fill="currentColor" />
          <rect x="11" y="2.5" width="3" height="11.5" rx="1" fill="currentColor" />
        </svg>
      </button>
    </>
  )
}
