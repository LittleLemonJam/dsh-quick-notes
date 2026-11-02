/**
 * Floating-window chrome: title-bar drag, eight resize handles, compact mode.
 *
 * `WindowFrame` owns only the window shell. App composes the body (directory,
 * divider, editor) and passes it as `children`, so this module must not make
 * layout decisions about the body. Geometry rules live in the pure
 * `geometry.js` module; this file owns pointer events, rAF throttling and the
 * `ui.rect` / `ui.compactRect` / `ui.mode` updates.
 *
 * Pointer capture keeps a gesture alive when the pointer leaves the element;
 * the store is updated once per animation frame, not once per mouse event.
 */
import React from 'react'
import { currentViewport, h } from '../dom.js'
import { noteGlyph } from '../launcher.js'
import {
  RESIZE_HANDLES,
  BALL_SIZE,
  clampBall,
  clampRect,
  compactRectOf,
  resizeRect,
} from './geometry.js'

/** Localized copy. */
export const I18N = {
  en: {
    'window.title': 'Quick notes',
    'window.compact': 'Notes only',
    'window.expand': 'Show directory',
    'window.minimize': 'Minimize to ball',
    'window.resetSize': 'Reset window size',
  },
  zh: {
    'window.title': '随想随记',
    'window.compact': '仅便签',
    'window.expand': '显示目录',
    'window.minimize': '缩成圆球',
    'window.resetSize': '恢复默认大小',
  },
}

/** Component styles. */
export const CSS = `
.qn-root .qn-window {
  position: fixed;
  z-index: 1;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  box-shadow:
    0 0 0 1px var(--dsw-alias-border-l2),
    0 18px 48px rgba(0, 0, 0, 0.24);
  overflow: visible;
}

.qn-root .qn-window-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 16px 0 12px;
  background: var(--dsw-alias-bg-layer-2);
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.06);
  border-radius: 11px 11px 0 0;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.qn-root .qn-window-bar[data-dragging='true'] {
  cursor: grabbing;
}

.qn-root .qn-window-title {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.qn-root .qn-window-title .qn-icon {
  flex: none;
  width: 15px;
  height: 15px;
  color: var(--dsw-alias-brand-primary);
}

.qn-root .qn-window-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qn-root .qn-window-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
}

.qn-root .qn-window-action {
  color: var(--dsw-alias-label-secondary);
}

.qn-root .qn-window-action:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.qn-root .qn-window-action[aria-pressed='true'] {
  color: var(--dsw-alias-brand-primary);
}

.qn-root .qn-window-content {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  border-radius: 0 0 11px 11px;
}

.qn-root .qn-resize {
  position: absolute;
  z-index: 2;
  touch-action: none;
}

.qn-root .qn-resize-n,
.qn-root .qn-resize-s {
  left: 12px;
  right: 12px;
  height: 6px;
  cursor: ns-resize;
}

.qn-root .qn-resize-e,
.qn-root .qn-resize-w {
  top: 12px;
  bottom: 12px;
  width: 6px;
  cursor: ew-resize;
}

.qn-root .qn-resize-n {
  top: -3px;
}

.qn-root .qn-resize-s {
  bottom: -3px;
}

.qn-root .qn-resize-e {
  right: -3px;
}

.qn-root .qn-resize-w {
  left: -3px;
}

.qn-root .qn-resize-ne {
  top: -2px;
  right: -2px;
  width: 12px;
  height: 12px;
  cursor: nesw-resize;
}

.qn-root .qn-resize-nw {
  top: -2px;
  left: -2px;
  width: 12px;
  height: 12px;
  cursor: nwse-resize;
}

.qn-root .qn-resize-se {
  bottom: -2px;
  right: -2px;
  width: 12px;
  height: 12px;
  cursor: nwse-resize;
}

.qn-root .qn-resize-sw {
  bottom: -2px;
  left: -2px;
  width: 12px;
  height: 12px;
  cursor: nesw-resize;
}
`

/** Shared attributes of the 16px line icons. */
const ICON_PROPS = {
  className: 'qn-icon',
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
}

/**
 * Build a line icon from its child shapes.
 * @param shapes - SVG child elements.
 * @returns the SVG element.
 */
function glyph(shapes) {
  return h('svg', ICON_PROPS, ...shapes)
}

/**
 * Title-bar panel icon with a chevron pointing at the directory column.
 * @param chevron - path data for the chevron.
 * @returns the SVG element.
 */
function panelGlyph(chevron) {
  return glyph([
    h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.5 }),
    h('path', { d: 'M9.5 4.5v15' }),
    h('path', { d: chevron }),
  ])
}

/** Title-bar icons; they are static React elements, built once. */
const COMPACT_ICON = panelGlyph('M7.5 10 5.5 12l2 2')
const EXPAND_ICON = panelGlyph('M5.5 10 7.5 12l-2 2')
const BALL_ICON = glyph([
  h('circle', { cx: 12, cy: 12, r: 5.5 }),
  h('path', { d: 'M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4' }),
])
const RESET_ICON = glyph([
  h('path', { d: 'M4 9V4h5' }),
  h('path', { d: 'M15 4h5v5' }),
  h('path', { d: 'M20 15v5h-5' }),
  h('path', { d: 'M9 20H4v-5' }),
])

/**
 * Compare two rectangles field by field.
 * @param left - first rectangle.
 * @param right - second rectangle.
 * @returns whether every field matches.
 */
function sameRect(left, right) {
  return ['x', 'y', 'width', 'height'].every((key) => left[key] === right[key])
}

/**
 * Render the window shell; `children` is the App-composed body (directory,
 * divider and editor), which this module only positions, never lays out.
 */
export function WindowFrame({ t, state, actions, children }) {
  const gestureRef = React.useRef(null)
  const latestRef = React.useRef({ state, actions })
  latestRef.current = { state, actions }

  const compact = state.ui.mode === 'compact'
  // Clamp the first paint too; the effect below persists the clamped value.
  const rect = clampRect(state.ui.rect, currentViewport())

  /** Apply one gesture position to the store. */
  function applyGesture(gesture, point) {
    const delta = { x: point.x - gesture.startX, y: point.y - gesture.startY }
    const view = currentViewport()
    const next =
      gesture.kind === 'move'
        ? clampRect(
            { ...gesture.rect, x: gesture.rect.x + delta.x, y: gesture.rect.y + delta.y },
            view,
          )
        : resizeRect(gesture.rect, gesture.handle, delta, view)
    if (!sameRect(next, latestRef.current.state.ui.rect)) {
      latestRef.current.actions.updateUi({ rect: next })
    }
  }

  /**
   * Build the pointerdown handler for the title bar or one resize handle.
   * @param kind - `'move'` for the title bar, `'resize'` for a handle.
   * @param handle - resize handle id, unused when `kind` is `'move'`.
   */
  function beginGesture(kind, handle) {
    return (event) => {
      if (event.button !== 0 || event.isPrimary === false) return
      if (gestureRef.current !== null) return
      const interactive =
        event.target instanceof Element && event.target.closest('button, a, input') !== null
      if (kind === 'move' && interactive) return
      event.preventDefault()
      gestureRef.current = {
        kind,
        handle,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        rect: { ...latestRef.current.state.ui.rect },
        point: null,
        frame: 0,
      }
      event.currentTarget.dataset.dragging = 'true'
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  /** Track a pointer movement, coalescing store updates into one rAF flush. */
  function handleGestureMove(event) {
    const gesture = gestureRef.current
    if (gesture === null || event.pointerId !== gesture.pointerId) return
    gesture.point = { x: event.clientX, y: event.clientY }
    if (gesture.frame !== 0) return
    gesture.frame = window.requestAnimationFrame(() => {
      gesture.frame = 0
      const pending = gesture.point
      gesture.point = null
      if (pending !== null) applyGesture(gesture, pending)
    })
  }

  /**
   * Finish, abort or drop a gesture; only `pointerup` commits the final position.
   * @param event - pointerup, pointercancel or lostpointercapture event.
   */
  function finishGesture(event) {
    const gesture = gestureRef.current
    if (gesture === null || event.pointerId !== gesture.pointerId) return
    if (gesture.frame !== 0) {
      window.cancelAnimationFrame(gesture.frame)
      gesture.frame = 0
    }
    gestureRef.current = null
    gesture.point = null
    if (event.type === 'pointerup') applyGesture(gesture, { x: event.clientX, y: event.clientY })
    const target = event.currentTarget
    target.dataset.dragging = 'false'
    if (target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId)
    }
  }

  /** Toggle between compact ("notes only") and normal mode. */
  function toggleCompact() {
    const current = latestRef.current
    const view = currentViewport()
    const ui = current.state.ui
    if (ui.mode === 'compact') {
      const restored = clampRect(ui.compactRect ?? ui.rect, view)
      current.actions.updateUi({ rect: restored, compactRect: null })
      current.actions.setMode('normal')
      return
    }
    const source = clampRect(ui.rect, view)
    current.actions.updateUi({ compactRect: source, rect: compactRectOf(source, view) })
    current.actions.setMode('compact')
  }

  /**
   * Minimize into the floating ball at the window's top-right corner, which is
   * clear of the other floating widgets that live at the bottom-right.
   */
  function minimize() {
    const current = latestRef.current
    const view = currentViewport()
    const rect = clampRect(current.state.ui.rect, view)
    const ball = clampBall(
      { x: rect.x + rect.width - BALL_SIZE - 12, y: rect.y + 12 },
      view,
      BALL_SIZE,
    )
    current.actions.updateUi({ ball })
    current.actions.setMode('ball')
  }

  /** Forward the "reset to default size" request to the store action. */
  function resetSize() {
    latestRef.current.actions.resetWindowSize?.()
  }

  React.useEffect(() => {
    /** Pull the window back into the viewport on mount and after a resize. */
    const onResize = () => {
      const current = latestRef.current
      const next = clampRect(current.state.ui.rect, currentViewport())
      if (!sameRect(next, current.state.ui.rect)) {
        current.actions.updateUi({ rect: next })
      }
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      const gesture = gestureRef.current
      if (gesture !== null && gesture.frame !== 0) window.cancelAnimationFrame(gesture.frame)
      gestureRef.current = null
    }
  }, [])

  /** Title-bar actions, in visual order: compact, minimize, reset size. */
  const titleActions = [
    {
      id: 'compact',
      label: compact ? t('window.expand') : t('window.compact'),
      pressed: compact,
      icon: compact ? EXPAND_ICON : COMPACT_ICON,
      onClick: toggleCompact,
    },
    { id: 'ball', label: t('window.minimize'), icon: BALL_ICON, onClick: minimize },
    { id: 'reset', label: t('window.resetSize'), icon: RESET_ICON, onClick: resetSize },
  ]

  return h(
    'section',
    {
      className: 'qn-window',
      role: 'region',
      'aria-label': t('window.title'),
      style: {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      },
    },
    h(
      'header',
      {
        className: 'qn-window-bar',
        'data-dragging': 'false',
        onPointerDown: beginGesture('move'),
        onPointerMove: handleGestureMove,
        onPointerUp: finishGesture,
        onPointerCancel: finishGesture,
        onLostPointerCapture: finishGesture,
      },
      h(
        'div',
        { className: 'qn-window-title' },
        noteGlyph({ size: 15 }),
        h('span', { className: 'qn-window-title-text' }, t('window.title')),
      ),
      h(
        'div',
        { className: 'qn-window-actions' },
        titleActions.map((action) =>
          h(
            'button',
            {
              key: action.id,
              type: 'button',
              className: 'qn-icon-button qn-window-action',
              'data-qn-action': action.id,
              title: action.label,
              'aria-label': action.label,
              'aria-pressed': action.pressed,
              onClick: action.onClick,
            },
            action.icon,
          ),
        ),
      ),
    ),
    h('div', { className: 'qn-window-content' }, children),
    RESIZE_HANDLES.map((handle) =>
      h('div', {
        key: handle,
        className: `qn-resize qn-resize-${handle}`,
        'data-qn-resize': handle,
        'data-dragging': 'false',
        'aria-hidden': 'true',
        onPointerDown: beginGesture('resize', handle),
        onPointerMove: handleGestureMove,
        onPointerUp: finishGesture,
        onPointerCancel: finishGesture,
        onLostPointerCapture: finishGesture,
      }),
    ),
  )
}
