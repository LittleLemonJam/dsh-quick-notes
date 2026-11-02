/**
 * Context-menu component tests (jsdom + react-dom).
 *
 * Focus: a denied clipboard permission must not look like a silent no-op — the
 * menu stays open and shows a status line instead of closing.
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
const { ContextMenu } = await import('../../src/client/components/context-menu.js')

const h = React.createElement

/**
 * Minimal translator that returns the key.
 * @param key - dictionary key.
 * @returns the key.
 */
function t(key) {
  return key
}

/**
 * Mount a menu around one editor element.
 * @returns `{ container, editor, root, closed, unmount }`.
 */
async function mountMenu() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const editor = document.createElement('div')
  editor.contentEditable = 'true'
  editor.textContent = 'selected text'
  container.appendChild(editor)
  const closed = []
  const root = createRoot(container)
  await act(async () => {
    root.render(
      h(ContextMenu, {
        t,
        x: 10,
        y: 10,
        editor,
        onBeforeAction: () => {},
        onClose: () => closed.push(true),
      }),
    )
  })
  return {
    container,
    editor,
    root,
    closed,
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

test('the menu only offers the four clipboard / clear commands', async () => {
  const menu = await mountMenu()
  try {
    const actions = Array.from(
      menu.container.querySelectorAll('[data-qn-menu-action]'),
      (element) => element.getAttribute('data-qn-menu-action'),
    )
    assert.deepEqual(actions, ['copy', 'cut', 'paste', 'clear'])
    assert.equal(menu.container.querySelectorAll('[data-qn-highlight], [data-qn-color]').length, 0)
  } finally {
    await menu.unmount()
  }
})

test('Escape closes the menu', async () => {
  const menu = await mountMenu()
  try {
    await act(async () => {
      document.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    assert.deepEqual(menu.closed, [true])
  } finally {
    await menu.unmount()
  }
})

test('a click outside the menu closes it', async () => {
  const menu = await mountMenu()
  try {
    await act(async () => {
      document.body.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }))
    })
    assert.deepEqual(menu.closed, [true])
  } finally {
    await menu.unmount()
  }
})

test('a denied clipboard keeps the menu open and shows a status line', async () => {
  const menu = await mountMenu()
  try {
    // jsdom has no execCommand and no navigator.clipboard, so pasteAtCaret
    // returns false exactly like a browser that denies clipboard-read.
    const paste = menu.container.querySelector('[data-qn-menu-action="paste"]')
    await act(async () => {
      paste.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    const status = menu.container.querySelector('[data-qn-menu-status]')
    assert.ok(status, 'a status line must be rendered')
    assert.equal(status.textContent, 'menu.clipboardFailed')
    assert.equal(status.getAttribute('role'), 'status')
    assert.deepEqual(menu.closed, [], 'the menu must stay open on failure')
  } finally {
    await menu.unmount()
  }
})
