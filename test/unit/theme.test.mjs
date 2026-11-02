/**
 * Theme tests: host-theme detection, preference resolution and the App
 * attribute that pins the plugin palette independently of the host theme.
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
globalThis.MutationObserver = dom.window.MutationObserver
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.fetch = async () => {
  throw new Error('offline')
}

const { resolvePluginTheme, themeFromDocument } = await import('../../src/client/theme.js')

/**
 * Build a fake document whose body paints the given background.
 * @param background - CSS background colour.
 * @returns the fake document.
 */
function fakeDocument(background, attribute = null) {
  const body = {
    hasAttribute: (name) => name === 'data-ds-dark-theme' && attribute !== null,
    getAttribute: (name) => (name === 'data-ds-dark-theme' ? attribute : null),
  }
  return {
    body,
    documentElement: body,
    defaultView: {
      getComputedStyle: () => ({ backgroundColor: background }),
      matchMedia: () => ({ matches: false }),
    },
  }
}

test('themeFromDocument reads the painted background luminance', () => {
  assert.equal(themeFromDocument(fakeDocument('rgb(255, 255, 255)')), 'light')
  assert.equal(themeFromDocument(fakeDocument('rgb(22, 25, 29)')), 'dark')
  assert.equal(themeFromDocument(fakeDocument('rgba(0, 0, 0, 0)')), 'light')
  assert.equal(themeFromDocument(null), 'light')
})

test('themeFromDocument falls back to the host attribute semantics', () => {
  assert.equal(themeFromDocument(fakeDocument('rgba(0, 0, 0, 0)', '')), 'dark')
  assert.equal(themeFromDocument(fakeDocument('rgba(0, 0, 0, 0)', 'true')), 'dark')
  assert.equal(themeFromDocument(fakeDocument('rgba(0, 0, 0, 0)', 'false')), 'light')
})

test('resolvePluginTheme pins a manual choice and follows the host otherwise', () => {
  assert.equal(resolvePluginTheme('light', 'dark'), 'light')
  assert.equal(resolvePluginTheme('dark', 'light'), 'dark')
  assert.equal(resolvePluginTheme('system', 'dark'), 'dark')
  assert.equal(resolvePluginTheme('system', 'light'), 'light')
})

test('the plugin root carries the resolved theme and mode attributes', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { act } = React
  const { App } = await import('../../src/client/app.js')
  const { createNotesStore } = await import('../../src/client/store.js')

  const storage = {
    readLocalState: () => null,
    writeLocalState: () => true,
    loadRemoteState: async () => null,
    saveRemoteState: async () => ({ savedAt: Date.now() }),
  }
  const store = createNotesStore({ storage })
  await act(async () => {
    await store.start()
  })
  // Host paints a dark page; the plugin preference pins it to light instead.
  document.body.style.backgroundColor = 'rgb(20, 22, 26)'
  await act(async () => store.actions.updateSettings({ theme: 'light' }))

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(App, { t: (key) => key, store }))
  })
  const overlay = container.querySelector('.qn-root')
  assert.equal(overlay.getAttribute('data-qn-theme'), 'light')
  assert.equal(overlay.getAttribute('data-qn-mode'), 'normal')

  await act(async () => store.actions.updateSettings({ theme: 'system' }))
  assert.equal(container.querySelector('.qn-root').getAttribute('data-qn-theme'), 'dark')

  await act(async () => store.actions.setMode('ball'))
  const ballOverlay = container.querySelector('.qn-root')
  assert.equal(ballOverlay.getAttribute('data-qn-mode'), 'ball')
  assert.ok(container.querySelector('[data-qn-ball]'), 'the minimized ball must render')

  await act(async () => root.unmount())
  container.remove()
  store.dispose()
})
