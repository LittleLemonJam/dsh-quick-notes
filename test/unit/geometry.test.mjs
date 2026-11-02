/**
 * Unit tests for the pure window / ball geometry.
 *
 * `geometry.js` has no DOM dependency, so the drag, resize, compact and ball
 * rules are exercised directly in Node. The tests pin the contract: the window
 * always stays inside the viewport below the host title bar, resizing keeps the
 * opposite edge fixed, sizes never fall below `WINDOW_MIN`, and compact mode
 * only shrinks the width.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BALL_CLICK_THRESHOLD,
  BALL_SIZE,
  COMPACT_MAX_WIDTH,
  RESIZE_HANDLES,
  SIDEBAR_LIMITS,
  WINDOW_MIN,
  WINDOW_TOP_INSET,
  clampBall,
  clampRect,
  clampSidebarWidth,
  compactRectOf,
  resizeRect,
} from '../../src/client/components/geometry.js'

/** A viewport large enough for the default window. */
const VIEWPORT = { width: 1280, height: 800 }

/** The rectangle most resize tests start from. */
const START = { x: 100, y: 100, width: 560, height: 440 }

/**
 * Right edge of a rectangle.
 * @param rect - rectangle.
 * @returns `x + width`.
 */
function right(rect) {
  return rect.x + rect.width
}

/**
 * Bottom edge of a rectangle.
 * @param rect - rectangle.
 * @returns `y + height`.
 */
function bottom(rect) {
  return rect.y + rect.height
}

test('geometry constants match the contract', () => {
  assert.deepEqual({ ...WINDOW_MIN }, { width: 320, height: 240 })
  assert.equal(WINDOW_TOP_INSET, 64)
  assert.equal(COMPACT_MAX_WIDTH, 460)
  assert.equal(BALL_SIZE, 56)
  assert.equal(BALL_CLICK_THRESHOLD, 4)
  assert.deepEqual(RESIZE_HANDLES.slice().sort(), ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'])
  assert.deepEqual({ ...SIDEBAR_LIMITS }, { min: 120, max: 320, default: 176 })
})

test('clampRect keeps a rectangle that already fits unchanged', () => {
  assert.deepEqual(clampRect({ x: 100, y: 80, width: 560, height: 440 }, VIEWPORT), {
    x: 100,
    y: 80,
    width: 560,
    height: 440,
  })
})

test('clampRect pulls negative coordinates below the host title bar', () => {
  assert.deepEqual(clampRect({ x: -120, y: -40, width: 560, height: 440 }, VIEWPORT), {
    x: 0,
    y: WINDOW_TOP_INSET,
    width: 560,
    height: 440,
  })
})

test('clampRect keeps the window below the host title bar', () => {
  assert.deepEqual(clampRect({ x: 100, y: 0, width: 560, height: 440 }, VIEWPORT), {
    x: 100,
    y: WINDOW_TOP_INSET,
    width: 560,
    height: 440,
  })
  assert.deepEqual(clampRect({ x: 100, y: 10, width: 560, height: 440 }, VIEWPORT), {
    x: 100,
    y: WINDOW_TOP_INSET,
    width: 560,
    height: 440,
  })
  // Already below the inset: the position is preserved.
  assert.deepEqual(clampRect({ x: 100, y: 200, width: 560, height: 440 }, VIEWPORT), {
    x: 100,
    y: 200,
    width: 560,
    height: 440,
  })
})

test('clampRect gives up the top inset only when the viewport is too short', () => {
  // 500px tall: maxY = 500 - 440 = 60, already below the inset.
  assert.deepEqual(
    clampRect({ x: 100, y: 0, width: 560, height: 440 }, { width: 1280, height: 500 }),
    { x: 100, y: 60, width: 560, height: 440 },
  )
  // 400px tall: the window is capped to the viewport, so y must be 0.
  assert.deepEqual(
    clampRect({ x: 100, y: 0, width: 560, height: 440 }, { width: 1280, height: 400 }),
    { x: 100, y: 0, width: 560, height: 400 },
  )
})

test('clampRect keeps the whole rectangle inside the viewport', () => {
  assert.deepEqual(clampRect({ x: 1000, y: 700, width: 560, height: 440 }, VIEWPORT), {
    x: 720,
    y: 360,
    width: 560,
    height: 440,
  })
})

test('clampRect follows a shrunk viewport', () => {
  assert.deepEqual(
    clampRect({ x: 900, y: 600, width: 560, height: 440 }, { width: 1000, height: 700 }),
    {
      x: 440,
      y: 260,
      width: 560,
      height: 440,
    },
  )
  assert.deepEqual(
    clampRect({ x: 900, y: 600, width: 560, height: 440 }, { width: 500, height: 300 }),
    {
      x: 0,
      y: 0,
      width: 500,
      height: 300,
    },
  )
})

test('clampRect raises sizes below the window minimum', () => {
  assert.deepEqual(clampRect({ x: 10, y: 10, width: 100, height: 80 }, VIEWPORT), {
    x: 10,
    y: WINDOW_TOP_INSET,
    width: WINDOW_MIN.width,
    height: WINDOW_MIN.height,
  })
  assert.deepEqual(clampRect({ x: 0, y: 0, width: -40, height: 0 }, VIEWPORT), {
    x: 0,
    y: WINDOW_TOP_INSET,
    width: WINDOW_MIN.width,
    height: WINDOW_MIN.height,
  })
})

test('clampRect lets a viewport smaller than the minimum win', () => {
  assert.deepEqual(clampRect(START, { width: 300, height: 200 }), {
    x: 0,
    y: 0,
    width: 300,
    height: 200,
  })
})

test('clampRect tolerates unusable input', () => {
  assert.deepEqual(clampRect({ x: NaN, y: '10', width: undefined, height: null }, VIEWPORT), {
    x: 0,
    y: WINDOW_TOP_INSET,
    width: WINDOW_MIN.width,
    height: WINDOW_MIN.height,
  })
  assert.deepEqual(clampRect(null, VIEWPORT), {
    x: 0,
    y: WINDOW_TOP_INSET,
    width: WINDOW_MIN.width,
    height: WINDOW_MIN.height,
  })
  // No viewport at all: the fallback viewport is exactly WINDOW_MIN sized, so
  // there is no room for the top inset.
  assert.deepEqual(clampRect(START), {
    x: 0,
    y: 0,
    width: WINDOW_MIN.width,
    height: WINDOW_MIN.height,
  })
})

test('clampRect does not mutate its input', () => {
  const rect = { x: -10, y: -20, width: 100, height: 90 }
  clampRect(rect, VIEWPORT)
  assert.deepEqual(rect, { x: -10, y: -20, width: 100, height: 90 })
})

test('resizeRect east grows the width and keeps the left edge', () => {
  const next = resizeRect(START, 'e', { x: 40, y: 0 }, VIEWPORT)
  assert.deepEqual(next, { x: 100, y: 100, width: 600, height: 440 })
  assert.equal(next.x, START.x)
  assert.equal(right(next), right(START) + 40)
})

test('resizeRect west moves the left edge and keeps the right edge', () => {
  const next = resizeRect(START, 'w', { x: 40, y: 0 }, VIEWPORT)
  assert.deepEqual(next, { x: 140, y: 100, width: 520, height: 440 })
  assert.equal(right(next), right(START))
})

test('resizeRect south grows the height and keeps the top edge', () => {
  const next = resizeRect(START, 's', { x: 0, y: 30 }, VIEWPORT)
  assert.deepEqual(next, { x: 100, y: 100, width: 560, height: 470 })
  assert.equal(next.y, START.y)
  assert.equal(bottom(next), bottom(START) + 30)
})

test('resizeRect north moves the top edge and keeps the bottom edge', () => {
  const next = resizeRect(START, 'n', { x: 0, y: 30 }, VIEWPORT)
  assert.deepEqual(next, { x: 100, y: 130, width: 560, height: 410 })
  assert.equal(bottom(next), bottom(START))
})

test('resizeRect corners move both axes and keep the opposite corner fixed', () => {
  const se = resizeRect(START, 'se', { x: 40, y: 30 }, VIEWPORT)
  assert.deepEqual(se, { x: 100, y: 100, width: 600, height: 470 })
  assert.equal(se.x, START.x)
  assert.equal(se.y, START.y)

  const nw = resizeRect(START, 'nw', { x: 40, y: 30 }, VIEWPORT)
  assert.deepEqual(nw, { x: 140, y: 130, width: 520, height: 410 })
  assert.equal(right(nw), right(START))
  assert.equal(bottom(nw), bottom(START))

  const ne = resizeRect(START, 'ne', { x: 40, y: 30 }, VIEWPORT)
  assert.deepEqual(ne, { x: 100, y: 130, width: 600, height: 410 })
  assert.equal(ne.x, START.x)
  assert.equal(bottom(ne), bottom(START))

  const sw = resizeRect(START, 'sw', { x: 40, y: 30 }, VIEWPORT)
  assert.deepEqual(sw, { x: 140, y: 100, width: 520, height: 470 })
  assert.equal(right(sw), right(START))
  assert.equal(sw.y, START.y)
})

test('resizeRect never goes below the minimum size', () => {
  const west = resizeRect(START, 'w', { x: 500, y: 0 }, VIEWPORT)
  assert.equal(west.width, WINDOW_MIN.width)
  assert.equal(right(west), right(START))

  const east = resizeRect(START, 'e', { x: -500, y: 0 }, VIEWPORT)
  assert.equal(east.width, WINDOW_MIN.width)
  assert.equal(east.x, START.x)

  const north = resizeRect(START, 'n', { x: 0, y: 500 }, VIEWPORT)
  assert.equal(north.height, WINDOW_MIN.height)
  assert.equal(bottom(north), bottom(START))

  const south = resizeRect(START, 's', { x: 0, y: -500 }, VIEWPORT)
  assert.equal(south.height, WINDOW_MIN.height)
  assert.equal(south.y, START.y)

  const northWest = resizeRect(START, 'nw', { x: 500, y: 500 }, VIEWPORT)
  assert.deepEqual(northWest, {
    x: right(START) - WINDOW_MIN.width,
    y: bottom(START) - WINDOW_MIN.height,
    width: WINDOW_MIN.width,
    height: WINDOW_MIN.height,
  })
})

test('resizeRect caps growth at the viewport edges', () => {
  const east = resizeRect(
    { x: 700, y: 100, width: 560, height: 440 },
    'e',
    { x: 200, y: 0 },
    VIEWPORT,
  )
  assert.equal(right(east), VIEWPORT.width)
  assert.equal(east.x, 700)

  const south = resizeRect(
    { x: 100, y: 300, width: 560, height: 440 },
    's',
    { x: 0, y: 200 },
    VIEWPORT,
  )
  assert.equal(bottom(south), VIEWPORT.height)
  assert.equal(south.y, 300)

  const west = resizeRect(START, 'w', { x: -300, y: 0 }, VIEWPORT)
  assert.equal(west.x, 0)
  assert.equal(right(west), right(START))

  const north = resizeRect(START, 'n', { x: 0, y: -300 }, VIEWPORT)
  assert.equal(north.y, WINDOW_TOP_INSET)
  assert.equal(bottom(north), bottom(START))

  const fullWidth = resizeRect(
    { x: 0, y: WINDOW_TOP_INSET, width: 320, height: 240 },
    'e',
    { x: 5000, y: 0 },
    VIEWPORT,
  )
  assert.equal(fullWidth.width, VIEWPORT.width)

  const fullHeight = resizeRect(
    { x: 0, y: WINDOW_TOP_INSET, width: 320, height: 240 },
    's',
    { x: 0, y: 5000 },
    VIEWPORT,
  )
  assert.equal(fullHeight.height, VIEWPORT.height - WINDOW_TOP_INSET)
})

test('resizeRect north edge stops at the host title bar', () => {
  const next = resizeRect(START, 'n', { x: 0, y: -300 }, VIEWPORT)
  assert.equal(next.y, WINDOW_TOP_INSET)
  assert.equal(bottom(next), bottom(START))
  assert.equal(next.height, bottom(START) - WINDOW_TOP_INSET)

  // Already at the minimum height: the top edge cannot move any higher either.
  const minimum = resizeRect(
    { x: 100, y: WINDOW_TOP_INSET, width: 560, height: WINDOW_MIN.height },
    'n',
    { x: 0, y: -200 },
    VIEWPORT,
  )
  assert.deepEqual(minimum, {
    x: 100,
    y: WINDOW_TOP_INSET,
    width: 560,
    height: WINDOW_MIN.height,
  })
})

test('resizeRect clamps a start rectangle that is already out of bounds', () => {
  const next = resizeRect(
    { x: -100, y: -100, width: 560, height: 440 },
    'e',
    { x: 10, y: 0 },
    VIEWPORT,
  )
  assert.deepEqual(next, { x: 0, y: WINDOW_TOP_INSET, width: 570, height: 440 })
})

test('resizeRect accepts uppercase handles and ignores unknown ones', () => {
  assert.deepEqual(
    resizeRect(START, 'E', { x: 40, y: 0 }, VIEWPORT),
    resizeRect(START, 'e', { x: 40, y: 0 }, VIEWPORT),
  )
  assert.deepEqual(resizeRect(START, 'nope', { x: 40, y: 30 }, VIEWPORT), START)
  assert.deepEqual(resizeRect(START, undefined, { x: 40, y: 30 }, VIEWPORT), START)
})

test('resizeRect treats missing or unusable deltas as no movement', () => {
  assert.deepEqual(resizeRect(START, 'e', undefined, VIEWPORT), START)
  assert.deepEqual(resizeRect(START, 'se', { x: NaN, y: 'x' }, VIEWPORT), START)
})

test('clampBall keeps the ball inside the viewport', () => {
  assert.deepEqual(clampBall({ x: 300, y: 200 }, VIEWPORT), { x: 300, y: 200 })
  assert.deepEqual(clampBall({ x: -30, y: -20 }, VIEWPORT), { x: 0, y: 0 })
  assert.deepEqual(clampBall({ x: 1250, y: 780 }, VIEWPORT), {
    x: VIEWPORT.width - BALL_SIZE,
    y: VIEWPORT.height - BALL_SIZE,
  })
})

test('clampBall respects a custom diameter and a tiny viewport', () => {
  assert.deepEqual(clampBall({ x: 1250, y: 780 }, VIEWPORT, 40), {
    x: VIEWPORT.width - 40,
    y: VIEWPORT.height - 40,
  })
  assert.deepEqual(clampBall({ x: 100, y: 100 }, { width: 40, height: 30 }), { x: 0, y: 0 })
})

test('clampBall tolerates unusable input and does not mutate it', () => {
  const ball = { x: NaN, y: -10 }
  assert.deepEqual(clampBall(ball, VIEWPORT), { x: 0, y: 0 })
  assert.deepEqual(clampBall(null, VIEWPORT), { x: 0, y: 0 })
  assert.deepEqual(clampBall(ball, { width: 0, height: 0 }), { x: 0, y: 0 })
  assert.deepEqual(ball, { x: NaN, y: -10 })
})

test('clampSidebarWidth keeps the directory column in range', () => {
  assert.equal(clampSidebarWidth(176), 176)
  assert.equal(clampSidebarWidth(100), SIDEBAR_LIMITS.min)
  assert.equal(clampSidebarWidth(500), SIDEBAR_LIMITS.max)
  assert.equal(clampSidebarWidth(176.6), 177)
  assert.equal(clampSidebarWidth(NaN), SIDEBAR_LIMITS.default)
  assert.equal(clampSidebarWidth('200'), SIDEBAR_LIMITS.default)
})

test('compactRectOf shrinks wide windows to the compact cap', () => {
  const compact = compactRectOf({ x: 100, y: 100, width: 900, height: 600 }, VIEWPORT)
  assert.deepEqual(compact, { x: 100, y: 100, width: COMPACT_MAX_WIDTH, height: 600 })
})

test('compactRectOf leaves narrower windows alone', () => {
  const narrow = { x: 100, y: 100, width: 320, height: 440 }
  assert.deepEqual(compactRectOf(narrow, VIEWPORT), narrow)
  assert.deepEqual(compactRectOf({ x: 100, y: 100, width: 460, height: 440 }, VIEWPORT), {
    x: 100,
    y: 100,
    width: 460,
    height: 440,
  })
})

test('compactRectOf pulls the compact window back into the viewport', () => {
  assert.deepEqual(compactRectOf({ x: 1000, y: 100, width: 560, height: 440 }, VIEWPORT), {
    x: VIEWPORT.width - COMPACT_MAX_WIDTH,
    y: 100,
    width: COMPACT_MAX_WIDTH,
    height: 440,
  })
})

test('compactRectOf respects the host title bar inset', () => {
  assert.deepEqual(compactRectOf({ x: 100, y: 0, width: 900, height: 600 }, VIEWPORT), {
    x: 100,
    y: WINDOW_TOP_INSET,
    width: COMPACT_MAX_WIDTH,
    height: 600,
  })
})

test('compactRectOf caps the width at the viewport and tolerates bad input', () => {
  assert.equal(compactRectOf(START, { width: 400, height: 700 }).width, 400)
  assert.deepEqual(compactRectOf(null, VIEWPORT), {
    x: 0,
    y: WINDOW_TOP_INSET,
    width: WINDOW_MIN.width,
    height: WINDOW_MIN.height,
  })
})

test('compactRectOf is idempotent and does not mutate its input', () => {
  const rect = { x: 100, y: 100, width: 900, height: 600 }
  const once = compactRectOf(rect, VIEWPORT)
  assert.deepEqual(compactRectOf(once, VIEWPORT), once)
  assert.deepEqual(rect, { x: 100, y: 100, width: 900, height: 600 })
})

test('compact mode keeps the original rectangle restorable', () => {
  const original = { x: 300, y: 200, width: 720, height: 500 }
  const compact = compactRectOf(original, VIEWPORT)
  // Restoring is a plain clamp of the remembered rectangle: for a rectangle
  // that already fit the viewport, the original comes back untouched.
  assert.deepEqual(clampRect(original, VIEWPORT), original)
  assert.notDeepEqual(compact, original)
  assert.equal(compact.width <= COMPACT_MAX_WIDTH, true)
})
