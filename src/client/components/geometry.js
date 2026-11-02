/**
 * Pure geometry helpers for the floating window and the minimized ball.
 *
 * No DOM, no React and no side effects: every function takes plain numbers or
 * plain objects and returns a fresh object, so drag / resize / compact rules
 * are unit-testable in Node (see test/unit/geometry.test.mjs). The component
 * layer (window.js, ball.js) owns pointer events and persistence; this module
 * only answers "where should the box be".
 *
 * Rectangles are `{ x, y, width, height }` in CSS pixels, relative to the
 * layout viewport. Windows stay fully inside the viewport and below
 * `WINDOW_TOP_INSET`, the native DSH title bar's drag strip (the constant is
 * shared with the Host through `src/shared/constants.js`).
 */
import { WINDOW_TOP_INSET } from '../../shared/constants.js'

export { WINDOW_TOP_INSET }

/** Minimum window size, in CSS pixels. */
export const WINDOW_MIN = Object.freeze({ width: 320, height: 240 })

/** Width cap applied when the window enters compact ("notes only") mode. */
export const COMPACT_MAX_WIDTH = 460

/** Minimized ball diameter, in CSS pixels. */
export const BALL_SIZE = 56

/** Pointer travel below this distance still counts as a click, in CSS pixels. */
export const BALL_CLICK_THRESHOLD = 4

/** Directory column width bounds, in CSS pixels. */
export const SIDEBAR_LIMITS = Object.freeze({ min: 120, max: 320, default: 176 })

/** The eight resize handles: four edges followed by four corners. */
export const RESIZE_HANDLES = Object.freeze(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'])

/** Read an object-like value, or an empty object so field reads never throw. */
function readObject(value) {
  return value !== null && typeof value === 'object' ? value : {}
}

/** Read a finite number, or a fallback when the candidate is unusable. */
function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Clamp a number into an inclusive range; non-finite input uses the fallback.
 * @param value - candidate number.
 * @param min - lower bound.
 * @param max - upper bound.
 * @param fallback - value used for non-finite input; defaults to `min`.
 * @returns the clamped number.
 */
function clampNumber(value, min, max, fallback = min) {
  return Math.min(max, Math.max(min, numberOr(value, fallback)))
}

/** Normalise a rectangle so later maths never sees `NaN`. */
function readRect(rect) {
  const source = readObject(rect)
  return {
    x: numberOr(source.x, 0),
    y: numberOr(source.y, 0),
    width: numberOr(source.width, WINDOW_MIN.width),
    height: numberOr(source.height, WINDOW_MIN.height),
  }
}

/**
 * Normalise a viewport, keeping it positive even for unusable host input.
 * @param viewport - candidate `{ width, height }`.
 * @returns a positive viewport size.
 */
function readViewport(viewport) {
  const source = readObject(viewport)
  const width = numberOr(source.width, WINDOW_MIN.width)
  const height = numberOr(source.height, WINDOW_MIN.height)
  return {
    width: width > 0 ? width : WINDOW_MIN.width,
    height: height > 0 ? height : WINDOW_MIN.height,
  }
}

/** Normalise a point-like object. */
function readPoint(point) {
  const source = readObject(point)
  return { x: numberOr(source.x, 0), y: numberOr(source.y, 0) }
}

/**
 * Keep a rectangle inside the viewport, below the host title bar and above the
 * minimum window size.
 *
 * The whole rectangle stays visible whenever the viewport can hold it: width and
 * height are first raised to `WINDOW_MIN` and capped at the viewport size, then
 * the position is clamped so the rectangle cannot leave the viewport. The top
 * edge additionally stops at `WINDOW_TOP_INSET` so the window never overlaps the
 * native drag strip; when the viewport is too short for both, staying fully
 * visible wins and the inset shrinks to the available space.
 *
 * @param rect - candidate rectangle.
 * @param viewport - `{ width, height }` of the layout viewport.
 * @returns the clamped rectangle (a new object).
 */
export function clampRect(rect, viewport) {
  const source = readRect(rect)
  const view = readViewport(viewport)
  const width = clampNumber(source.width, WINDOW_MIN.width, view.width)
  const height = clampNumber(source.height, WINDOW_MIN.height, view.height)
  const maxX = Math.max(0, view.width - width)
  const maxY = Math.max(0, view.height - height)
  return {
    x: clampNumber(source.x, 0, maxX),
    y: clampNumber(source.y, Math.min(WINDOW_TOP_INSET, maxY), maxY),
    width,
    height,
  }
}

/**
 * Resize a rectangle by dragging one of the eight handles.
 *
 * The opposite edge stays fixed: dragging `w` moves the left edge and keeps the
 * right edge in place, dragging `n` moves the top edge and keeps the bottom edge
 * in place, and corners combine both rules. Sizes are bounded by `WINDOW_MIN`
 * and by the viewport, the moving edge never leaves the viewport, and the top
 * edge stops at `WINDOW_TOP_INSET` like `clampRect` does.
 *
 * `delta` is the total pointer travel since the gesture started (not an
 * incremental step), and `startRect` is the rectangle captured on pointerdown.
 *
 * @param startRect - rectangle at gesture start.
 * @param handle - one of `n`, `s`, `e`, `w`, `ne`, `nw`, `se`, `sw`.
 * @param delta - total pointer travel `{ x, y }` in CSS pixels.
 * @param viewport - `{ width, height }` of the layout viewport.
 * @returns the resized rectangle (a new object).
 */
export function resizeRect(startRect, handle, delta, viewport) {
  const start = clampRect(startRect, viewport)
  const view = readViewport(viewport)
  const move = readPoint(delta)
  const key = typeof handle === 'string' ? handle.toLowerCase() : ''
  if (!RESIZE_HANDLES.includes(key)) return { ...start }
  let { x, y, width, height } = start

  if (key.includes('e')) {
    const maxWidth = Math.max(WINDOW_MIN.width, view.width - start.x)
    width = clampNumber(start.width + move.x, WINDOW_MIN.width, maxWidth)
  } else if (key.includes('w')) {
    const right = start.x + start.width
    x = clampNumber(start.x + move.x, 0, Math.max(0, right - WINDOW_MIN.width))
    width = right - x
  }

  if (key.includes('s')) {
    const maxHeight = Math.max(WINDOW_MIN.height, view.height - start.y)
    height = clampNumber(start.height + move.y, WINDOW_MIN.height, maxHeight)
  } else if (key.includes('n')) {
    const bottom = start.y + start.height
    const maxY = Math.max(0, bottom - WINDOW_MIN.height)
    y = clampNumber(start.y + move.y, Math.min(WINDOW_TOP_INSET, maxY), maxY)
    height = bottom - y
  }

  return { x, y, width, height }
}

/**
 * Keep the minimized ball inside the viewport.
 * @param ball - ball top-left corner `{ x, y }`.
 * @param viewport - `{ width, height }` of the layout viewport.
 * @param size - ball diameter in CSS pixels; defaults to `BALL_SIZE`.
 * @returns the clamped ball position (a new object).
 */
export function clampBall(ball, viewport, size = BALL_SIZE) {
  const point = readPoint(ball)
  const view = readViewport(viewport)
  const diameter = Math.max(1, numberOr(size, BALL_SIZE))
  return {
    x: clampNumber(point.x, 0, Math.max(0, view.width - diameter)),
    y: clampNumber(point.y, 0, Math.max(0, view.height - diameter)),
  }
}

/**
 * Clamp the directory column width to its allowed range.
 * @param width - candidate width in CSS pixels.
 * @returns the clamped width, rounded to whole pixels.
 */
export function clampSidebarWidth(width) {
  const value = clampNumber(width, SIDEBAR_LIMITS.min, SIDEBAR_LIMITS.max, SIDEBAR_LIMITS.default)
  return Math.round(value)
}

/**
 * Build the rectangle a window uses in compact ("notes only") mode.
 *
 * The width shrinks to `COMPACT_MAX_WIDTH` at most while the position, height
 * and (already narrower) width are preserved; the result is then pulled back
 * into the viewport so the compact window never hangs off-screen.
 *
 * @param rect - current window rectangle (the one to remember for restoring).
 * @param viewport - `{ width, height }` of the layout viewport.
 * @returns the compact rectangle (a new object).
 */
export function compactRectOf(rect, viewport) {
  const source = readRect(rect)
  return clampRect({ ...source, width: Math.min(source.width, COMPACT_MAX_WIDTH) }, viewport)
}
