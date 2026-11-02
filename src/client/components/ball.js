/**
 * Minimized floating ball.
 *
 * A 56px draggable ball that replaces the window in `mode: 'ball'`. Dragging
 * moves it and persists `ui.ball` (rAF throttled); a pointer gesture that never
 * travels beyond `BALL_CLICK_THRESHOLD` is treated as a click and restores the
 * window with `actions.setMode('normal')`. Geometry is clamped to the viewport
 * here and again whenever the window is resized; a corrupt persisted position
 * falls back to a visible bottom-right spot instead of hiding the ball.
 */
import React from 'react'
import { currentViewport, h } from '../dom.js'
import { noteGlyph } from '../launcher.js'
import { reportDiagnostic } from '../diagnostics.js'
import { BALL_CLICK_THRESHOLD, BALL_SIZE, clampBall } from './geometry.js'

/** Localized copy. */
export const I18N = {
  en: {
    'ball.restore': 'Restore quick notes',
  },
  zh: {
    'ball.restore': '展开随想随记',
  },
}

/** Component styles. */
export const CSS = `
.qn-root .qn-ball {
  position: fixed;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  pointer-events: auto;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
  color: var(--dsw-alias-brand-primary);
  cursor: grab;
  touch-action: none;
  user-select: none;
  transition: border-color 120ms ease;
}

.qn-root .qn-ball:hover {
  border-color: var(--dsw-alias-border-l2);
}

.qn-root .qn-ball[data-dragging='true'] {
  cursor: grabbing;
}

.qn-root .qn-ball .qn-icon {
  width: 22px;
  height: 22px;
}
`

/** Compare two ball positions field by field. */
function sameBall(left, right) {
  return left.x === right.x && left.y === right.y
}

/**
 * Measure the rendered ball, tolerating detached or unmeasurable nodes.
 * @param node - ball element.
 * @returns `{ x, y, width, height }` in rounded CSS pixels, or null.
 */
function measureBall(node) {
  try {
    const rect = node?.getBoundingClientRect?.()
    if (rect === undefined || rect === null) return null
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  } catch {
    return null
  }
}

/**
 * Render the minimized ball.
 * @param props - `t`, `state`, `actions`.
 * @returns the ball element.
 */
export function MinimizedBall({ t, state, actions }) {
  const gestureRef = React.useRef(null)
  const ballRef = React.useRef(null)
  const latestRef = React.useRef({ state, actions })
  latestRef.current = { state, actions }

  // Clamp for the first paint too, so a ball persisted on a larger screen is
  // visible immediately; the effect below persists the clamped position.
  const viewport = currentViewport()
  const stored = state.ui.ball
  const initial =
    Number.isFinite(stored?.x) && Number.isFinite(stored?.y)
      ? stored
      : { x: viewport.width - BALL_SIZE - 24, y: viewport.height - BALL_SIZE - 24 }
  const ball = clampBall(initial, viewport, BALL_SIZE)
  const label = t('ball.restore')

  // Mount ping for the minimized state: a maintainer can tell whether the ball
  // actually rendered and where, which a screenshot-less deployment cannot.
  React.useEffect(() => {
    const measured = measureBall(ballRef.current)
    const rectText =
      measured === null
        ? 'rect=none'
        : `rect=${measured.x},${measured.y},${measured.width}x${measured.height}`
    reportDiagnostic('ball.mounted', {
      // `message` is in every diagnostic whitelist, so the position stays
      // readable even when a running Host predates the structured fields.
      message: `left=${ball.x} top=${ball.y} viewport=${viewport.width}x${viewport.height} ${rectText}`,
      left: ball.x,
      top: ball.y,
      viewport,
      rect: measured,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only ping
  }, [])

  /** Apply one drag position to the store. */
  function applyDrag(gesture, point) {
    const next = clampBall(
      {
        x: gesture.ball.x + (point.x - gesture.startX),
        y: gesture.ball.y + (point.y - gesture.startY),
      },
      currentViewport(),
      BALL_SIZE,
    )
    if (!sameBall(next, latestRef.current.state.ui.ball)) {
      latestRef.current.actions.updateUi({ ball: next })
    }
  }

  /**
   * Start dragging the ball.
   * @param event - pointerdown event.
   */
  function handlePointerDown(event) {
    if (event.button !== 0 || event.isPrimary === false) return
    if (gestureRef.current !== null) return
    event.preventDefault()
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      ball: { ...latestRef.current.state.ui.ball },
      moved: false,
      point: null,
      frame: 0,
    }
    event.currentTarget.dataset.dragging = 'true'
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  /** Track a drag beyond the click threshold, coalescing updates per frame. */
  function handlePointerMove(event) {
    const gesture = gestureRef.current
    if (gesture === null || event.pointerId !== gesture.pointerId) return
    if (!gesture.moved) {
      const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY)
      if (distance < BALL_CLICK_THRESHOLD) return
      gesture.moved = true
    }
    gesture.point = { x: event.clientX, y: event.clientY }
    if (gesture.frame !== 0) return
    gesture.frame = window.requestAnimationFrame(() => {
      gesture.frame = 0
      const pending = gesture.point
      gesture.point = null
      if (pending !== null) applyDrag(gesture, pending)
    })
  }

  /**
   * Finish or drop a gesture. A pointerup that never travelled restores the
   * window; a pointer-generated `click` still fires afterwards, so `handleClick`
   * only handles keyboard activation (`detail === 0`).
   * @param event - pointerup, pointercancel or lostpointercapture event.
   */
  function endDrag(event) {
    const gesture = gestureRef.current
    if (gesture === null || event.pointerId !== gesture.pointerId) return
    const cancelled = event.type !== 'pointerup'
    if (gesture.frame !== 0) {
      window.cancelAnimationFrame(gesture.frame)
      gesture.frame = 0
    }
    gestureRef.current = null
    gesture.point = null
    if (!cancelled && gesture.moved) applyDrag(gesture, { x: event.clientX, y: event.clientY })
    const target = event.currentTarget
    target.dataset.dragging = 'false'
    if (target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId)
    }
    if (!cancelled && !gesture.moved) latestRef.current.actions.setMode('normal')
  }

  /**
   * Restore the window when the button is activated from the keyboard.
   * @param event - click event.
   */
  function handleClick(event) {
    if (event.detail > 0) return
    latestRef.current.actions.setMode('normal')
  }

  React.useEffect(() => {
    /** Pull the ball back into the viewport on mount and after a resize. */
    const onResize = () => {
      const current = latestRef.current.state.ui.ball
      const next = clampBall(current, currentViewport(), BALL_SIZE)
      if (!sameBall(next, current)) {
        latestRef.current.actions.updateUi({ ball: next })
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

  return h(
    'button',
    {
      ref: ballRef,
      type: 'button',
      className: 'qn-ball',
      style: { left: `${ball.x}px`, top: `${ball.y}px` },
      title: label,
      'aria-label': label,
      'data-qn-ball': 'true',
      'data-dragging': 'false',
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onLostPointerCapture: endDrag,
      onClick: handleClick,
    },
    noteGlyph({ size: 22 }),
  )
}
