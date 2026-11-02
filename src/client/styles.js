/**
 * Client stylesheet assembly.
 *
 * The base sheet owns the overlay root, shared controls and the layout of the
 * window body. Each component module owns its own CSS string so parallel work
 * never edits the same stylesheet.
 */
import { CSS as WINDOW_CSS } from './components/window.js'
import { CSS as BALL_CSS } from './components/ball.js'
import { CSS as SIDEBAR_CSS } from './components/sidebar.js'
import { CSS as SETTINGS_CSS } from './components/settings.js'
import { CSS as TRASH_CSS } from './components/trash.js'
import { CSS as EDITOR_CSS } from './components/editor.js'
import { CSS as MENU_CSS } from './components/context-menu.js'
import { CSS as LAUNCHER_CSS } from './launcher.js'

/**
 * Base sheet: overlay root, window body layout, divider, shared controls.
 *
 * Surfaces and text resolve through `--dsw-alias-*` variables; this overlay
 * redefines those variables for its own palette (the only place literal colours
 * live), so the notes theme is independent of the host theme. Component sheets
 * still reference variables only. The translucent shadow is chrome depth, not a
 * themed colour.
 */
const BASE_CSS = `
/*
 * The plugin owns its palette so the user can pin the notes theme independently
 * of the host theme. These variables override the host tokens *inside* the
 * overlay only; every component keeps reading --dsw-alias-* names, and the
 * values below are the light palette. The dark palette is applied by the
 * data-qn-theme attribute that App resolves from settings.theme + host theme.
 */
.qn-root {
  position: fixed;
  inset: 0;
  z-index: 60;
  pointer-events: none;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  text-align: left;
  /* The plugin palette is independent of the host palette; keep native widget
     rendering (scrollbars, form controls) in the same colour scheme too. */
  color-scheme: light;
  --dsw-alias-bg-base: #ffffff;
  --dsw-alias-bg-layer-1: #ffffff;
  --dsw-alias-bg-layer-2: #f4f6f8;
  --dsw-alias-bg-overlay: #ffffff;
  --dsw-alias-border-l1: #e4e7ec;
  --dsw-alias-border-l2: #c4cbd4;
  --dsw-alias-brand-primary: #247bbf;
  --dsw-alias-interactive-bg-hover: #eef1f5;
  --dsw-alias-interactive-bg-hover-danger: #fdecec;
  --dsw-alias-label-primary: #1f2328;
  --dsw-alias-label-primary-inverted: #ffffff;
  --dsw-alias-label-secondary: #5f6b7a;
  --dsw-alias-label-tertiary: #8a94a0;
  --dsw-alias-link: #247bbf;
  --dsw-alias-state-error-primary: #d64545;
  --dsw-alias-state-success-primary: #2f8a4b;
  --dsw-alias-state-warn-primary: #c76b1c;
  /* Light paper is a warm beige, per the product request; the rule colour is
     the lined-paper ink and both follow the active palette. */
  --qn-paper-bg: #fbf3df;
  --qn-rule-color: #e8d9b5;
  --qn-line-height: 26px;
}

.qn-root[data-qn-theme='dark'] {
  color-scheme: dark;
  --dsw-alias-bg-base: #16191d;
  --dsw-alias-bg-layer-1: #1d2126;
  --dsw-alias-bg-layer-2: #252a31;
  --dsw-alias-bg-overlay: #1b1f24;
  --dsw-alias-border-l1: #343b44;
  --dsw-alias-border-l2: #4b5560;
  --dsw-alias-brand-primary: #5aa9e6;
  --dsw-alias-interactive-bg-hover: #2c333b;
  --dsw-alias-interactive-bg-hover-danger: #3a2626;
  --dsw-alias-label-primary: #e8ebef;
  --dsw-alias-label-primary-inverted: #1f2328;
  --dsw-alias-label-secondary: #a6aeb9;
  --dsw-alias-label-tertiary: #7c8694;
  --dsw-alias-link: #7cc0ff;
  --dsw-alias-state-error-primary: #ef6b6b;
  --dsw-alias-state-success-primary: #58b878;
  --dsw-alias-state-warn-primary: #e0a04a;
  --qn-paper-bg: #1c2025;
  --qn-rule-color: #2f363f;
}

/*
 * The minimized ball must stay visible above other floating widgets (the
 * sidebar whale, cost badges, ...), which use their own very high z-index.
 * Only the 56px ball is promoted; the full window keeps the normal layer so it
 * never covers host dialogs.
 */
.qn-root[data-qn-mode='ball'] {
  z-index: 2147483640;
}

.qn-root *,
.qn-root *::before,
.qn-root *::after {
  box-sizing: border-box;
}

.qn-root button {
  font: inherit;
  color: inherit;
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  cursor: pointer;
}

.qn-root button:focus-visible,
.qn-root [role='button']:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

.qn-root ::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.qn-root ::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-border-l2);
  border-radius: 999px;
}

.qn-root ::-webkit-scrollbar-track {
  background: transparent;
}

.qn-body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
}

.qn-body-compact {
  flex-direction: column;
}

.qn-divider {
  flex: 0 0 5px;
  width: 5px;
  cursor: col-resize;
  background: transparent;
  position: relative;
  touch-action: none;
}

.qn-divider::after {
  content: '';
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 2px;
  width: 1px;
  background: var(--dsw-alias-border-l1);
}

.qn-divider:hover::after,
.qn-divider[data-dragging='true']::after {
  background: var(--dsw-alias-brand-primary);
}

.qn-icon {
  display: block;
  width: 16px;
  height: 16px;
  pointer-events: none;
}

.qn-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: var(--dsw-alias-label-secondary);
  flex: none;
  transition: background 120ms ease, color 120ms ease;
}

.qn-icon-button:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}

.qn-icon-button[aria-pressed='true'] {
  color: var(--dsw-alias-brand-primary);
}

.qn-icon-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.qn-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.qn-crash {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 520px;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
  pointer-events: auto;
}
`

/** The complete stylesheet injected by the Client half. */
export const CSS = [
  BASE_CSS,
  WINDOW_CSS,
  BALL_CSS,
  SIDEBAR_CSS,
  SETTINGS_CSS,
  TRASH_CSS,
  EDITOR_CSS,
  MENU_CSS,
  LAUNCHER_CSS,
].join('\n')
