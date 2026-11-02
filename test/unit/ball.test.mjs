/**
 * Minimized-ball component tests (jsdom + react-dom).
 *
 * The ball used to render off the visible surface behind other floating widgets;
 * these tests lock the placement fallback/clamp, the click-to-restore path and
 * the promoted z-index layer that keeps the ball visible.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'http://127.0.0.1:58587/',
})

globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
})
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const posted = []
globalThis.fetch = async (url, init) => {
  posted.push({ url, body: init?.body })
  return {
    ok: true,
    status: 200,
    async json() {
      return { ok: true }
    },
  }
}

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React
const {
  MinimizedBall,
  I18N: BALL_I18N,
  CSS: BALL_CSS,
} = await import('../../src/client/components/ball.js')
const { CSS: BASE_CSS } = await import('../../src/client/styles.js')

const h = React.createElement
const t = (key) => key

/**
 * Mount the ball and return its handles.
 * @param ball - persisted ball position.
 * @param notes - note list.
 * @returns `{ container, root, actions, unmount }`.
 */
async function mountBall(ball, notes = []) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const calls = []
  const actions = {
    setMode(mode) {
      calls.push(mode)
    },
    updateUi(patch) {
      calls.push(patch)
    },
  }
  const state = { ui: { ball }, notes }
  await act(async () => {
    root.render(h(MinimizedBall, { t, state, actions }))
  })
  return {
    container,
    root,
    calls,
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

test('an off-screen persisted ball is clamped into the viewport', async () => {
  const ball = await mountBall({ x: 99999, y: -500 }, [{ id: 'n1' }])
  try {
    const node = ball.container.querySelector('[data-qn-ball]')
    const left = Number.parseFloat(node.style.left)
    const top = Number.parseFloat(node.style.top)
    assert.ok(left >= 0 && left <= window.innerWidth - 56)
    assert.ok(top >= 0 && top <= window.innerHeight - 56)
    assert.equal(node.getAttribute('title'), 'ball.restore')
  } finally {
    await ball.unmount()
  }
})

test('the ball renders no note-count badge and keeps only the restore copy', async () => {
  const ball = await mountBall({ x: 40, y: 40 }, [{ id: 'n1' }, { id: 'n2' }])
  try {
    const node = ball.container.querySelector('[data-qn-ball]')
    assert.equal(node.querySelector('.qn-ball-badge'), null, 'the count badge must be removed')
    assert.equal(node.getAttribute('title'), 'ball.restore')
    assert.equal(node.getAttribute('aria-label'), 'ball.restore')
    assert.equal(BALL_CSS.includes('qn-ball-badge'), false)
    assert.deepEqual(Object.keys(BALL_I18N.en).sort(), ['ball.restore'])
    assert.deepEqual(Object.keys(BALL_I18N.zh).sort(), ['ball.restore'])
  } finally {
    await ball.unmount()
  }
})

test('a corrupt persisted ball falls back to a visible position', async () => {
  const ball = await mountBall({ x: Number.NaN, y: undefined })
  try {
    const node = ball.container.querySelector('[data-qn-ball]')
    const left = Number.parseFloat(node.style.left)
    const top = Number.parseFloat(node.style.top)
    assert.ok(Number.isFinite(left) && Number.isFinite(top))
    assert.ok(left >= 0 && left <= window.innerWidth - 56)
    assert.ok(top >= 0 && top <= window.innerHeight - 56)
  } finally {
    await ball.unmount()
  }
})

test('a click without travel restores the window', async () => {
  const ball = await mountBall({ x: 40, y: 40 })
  try {
    const node = ball.container.querySelector('[data-qn-ball]')
    await act(async () => {
      node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 0 }))
    })
    assert.deepEqual(ball.calls, ['normal'])
  } finally {
    await ball.unmount()
  }
})

test('mounting reports a diagnostic and the ball layer sits above other widgets', async () => {
  // The reporter throttles identical messages for 5s, so mount at a position no
  // earlier test used; this keeps the mount diagnostic the latest one recorded.
  posted.length = 0
  const ball = await mountBall({ x: 200, y: 150 })
  try {
    const mounted = posted
      .map((entry) => {
        try {
          return JSON.parse(entry.body)
        } catch {
          return null
        }
      })
      .filter((entry) => entry?.kind === 'ball.mounted')
    assert.ok(mounted.length > 0, 'a ball.mounted diagnostic must be posted')
    assert.match(mounted[mounted.length - 1].message, /left=200 top=150/)
    assert.match(BASE_CSS, /\.qn-root\[data-qn-mode='ball'\]\s*\{[^}]*z-index:\s*2147483640/)
  } finally {
    await ball.unmount()
  }
})
