/**
 * Window chrome tests (jsdom + react-dom).
 *
 * Focus: minimizing places the ball at the window's top-right corner (the fix
 * for the invisible-ball report) and still switches the mode to `ball`.
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

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React
const { WindowFrame } = await import('../../src/client/components/window.js')

const h = React.createElement
const t = (key) => key

/**
 * Render the window frame with a fixed rectangle.
 * @returns the handles and recorded actions.
 */
async function mountWindow() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const calls = []
  const actions = {
    updateUi(patch) {
      calls.push({ type: 'ui', patch })
    },
    setMode(mode) {
      calls.push({ type: 'mode', mode })
    },
    resetWindowSize() {
      calls.push({ type: 'reset' })
    },
  }
  const state = {
    ui: {
      mode: 'normal',
      rect: { x: 100, y: 100, width: 500, height: 400 },
      compactRect: null,
      sidebarWidth: 176,
      ball: { x: 0, y: 0 },
    },
  }
  await act(async () => {
    root.render(h(WindowFrame, { t, state, actions }, h('div', { className: 'qn-body' }, 'body')))
  })
  return {
    container,
    calls,
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

test('minimizing places the ball at the window top-right corner', async () => {
  const windowFrame = await mountWindow()
  try {
    const minimize = windowFrame.container.querySelector('[data-qn-action="ball"]')
    await act(async () => {
      minimize.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    const uiCall = windowFrame.calls.find((call) => call.type === 'ui')
    const modeCall = windowFrame.calls.find((call) => call.type === 'mode')
    assert.deepEqual(uiCall.patch.ball, { x: 100 + 500 - 56 - 12, y: 100 + 12 })
    assert.equal(modeCall.mode, 'ball')
  } finally {
    await windowFrame.unmount()
  }
})

test('the compact toggle keeps the normal rectangle for restoring', async () => {
  const windowFrame = await mountWindow()
  try {
    const compact = windowFrame.container.querySelector('[data-qn-action="compact"]')
    await act(async () => {
      compact.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    const uiCall = windowFrame.calls.find((call) => call.type === 'ui')
    assert.deepEqual(uiCall.patch.compactRect, { x: 100, y: 100, width: 500, height: 400 })
    assert.equal(windowFrame.calls.find((call) => call.type === 'mode').mode, 'compact')
  } finally {
    await windowFrame.unmount()
  }
})

test('the reset button forwards to actions.resetWindowSize', async () => {
  const windowFrame = await mountWindow()
  try {
    const buttons = [...windowFrame.container.querySelectorAll('[data-qn-action]')]
    assert.deepEqual(
      buttons.map((button) => button.getAttribute('data-qn-action')),
      ['compact', 'ball', 'reset'],
    )
    const reset = buttons[2]
    assert.equal(reset.getAttribute('title'), 'window.resetSize')
    assert.equal(reset.getAttribute('aria-label'), 'window.resetSize')
    await act(async () => {
      reset.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    assert.deepEqual(
      windowFrame.calls.filter((call) => call.type === 'reset'),
      [{ type: 'reset' }],
    )
  } finally {
    await windowFrame.unmount()
  }
})
