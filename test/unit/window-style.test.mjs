/**
 * Style regression tests for the floating-window chrome.
 *
 * These pin the two visual fixes from user testing — a stronger window border
 * (`--dsw-alias-border-l2` plus an outer ring) and a clear separator under the
 * title bar — together with the structural invariants that must not regress:
 * the button order, the pointer-drag wiring and the content overflow rule that
 * the context menu relies on.
 *
 * `window.js` imports React from the host module table, so a module resolve
 * hook installs a tiny React stub before the module is imported; only the
 * exported `CSS` string and the module source are inspected here.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

/** Minimal ESM React stub: any hook returns null, createElement is callable. */
const REACT_STUB = `
const React = new Proxy({}, { get: () => () => null })
export default React
`
const REACT_STUB_URL = `data:text/javascript,${encodeURIComponent(REACT_STUB)}`

/** Loader (used only on Node versions without `module.registerHooks`). */
const LOADER_SOURCE = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'react') {
    return { url: ${JSON.stringify(REACT_STUB_URL)}, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
`

/**
 * Make `import React from 'react'` resolvable for the component module.
 * @returns {Promise<void>} resolves once the hook is installed.
 */
async function installReactStub() {
  const nodeModule = await import('node:module')
  if (typeof nodeModule.registerHooks === 'function') {
    nodeModule.registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier === 'react') return { url: REACT_STUB_URL, shortCircuit: true }
        return nextResolve(specifier, context)
      },
    })
    return
  }
  await nodeModule.register(`data:text/javascript,${encodeURIComponent(LOADER_SOURCE)}`)
}

await installReactStub()

const MODULE_URL = new URL('../../src/client/components/window.js', import.meta.url)
const windowModule = await import(MODULE_URL.href)
const SOURCE = await readFile(MODULE_URL, 'utf8')

/**
 * Extract the declaration body of one CSS rule.
 * @param css - stylesheet text.
 * @param selector - exact selector line, without the trailing `{`.
 * @returns the declarations between the braces.
 */
function ruleBlock(css, selector) {
  const marker = `${selector} {`
  const start = css.indexOf(marker)
  assert.notEqual(start, -1, `CSS rule is missing: ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  assert.notEqual(close, -1, `CSS rule is not closed: ${selector}`)
  return css.slice(open + 1, close)
}

test('module still exports the component contract', () => {
  assert.equal(typeof windowModule.WindowFrame, 'function')
  assert.equal(typeof windowModule.CSS, 'string')
  assert.ok(windowModule.CSS.length > 0)
  assert.equal(typeof windowModule.I18N, 'object')
  assert.equal(typeof windowModule.I18N.en, 'object')
  assert.equal(typeof windowModule.I18N.zh, 'object')
  assert.deepEqual(
    Object.keys(windowModule.I18N.en).sort(),
    Object.keys(windowModule.I18N.zh).sort(),
    'window en/zh keys must match',
  )
  for (const key of [
    'window.title',
    'window.compact',
    'window.expand',
    'window.minimize',
    'window.resetSize',
  ]) {
    assert.ok(windowModule.I18N.en[key], `missing English copy: ${key}`)
    assert.ok(windowModule.I18N.zh[key], `missing Chinese copy: ${key}`)
  }
})

test('window border uses border-l2 plus an outer ring', () => {
  const rule = ruleBlock(windowModule.CSS, '.qn-root .qn-window')
  assert.match(rule, /border:\s*1px solid var\(--dsw-alias-border-l2\);/)
  assert.match(rule, /0 0 0 1px var\(--dsw-alias-border-l2\)/)
  assert.match(rule, /0 18px 48px rgba\(0, 0, 0, 0\.24\);/)
  assert.doesNotMatch(rule, /--dsw-alias-border-l1/)
  // Layout/geometry hooks that other modules and tests depend on.
  assert.match(rule, /position: fixed;/)
  assert.match(rule, /border-radius: 12px;/)
  assert.match(rule, /overflow: visible;/)
})

test('title bar has a clear separator from the content', () => {
  const rule = ruleBlock(windowModule.CSS, '.qn-root .qn-window-bar')
  assert.match(rule, /border-bottom:\s*1px solid var\(--dsw-alias-border-l2\);/)
  assert.match(rule, /box-shadow:\s*inset 0 -1px 0 rgba\(0, 0, 0, 0\.06\);/)
  assert.doesNotMatch(rule, /--dsw-alias-border-l1/)
  // Title-bar height and drag affordances stay untouched.
  assert.match(rule, /height: 38px;/)
  assert.match(rule, /cursor: grab;/)
  assert.match(rule, /touch-action: none;/)
})

test('content overflow stays hidden (context menu relies on it)', () => {
  const rule = ruleBlock(windowModule.CSS, '.qn-root .qn-window-content')
  assert.match(rule, /overflow: hidden;/)
  assert.match(rule, /display: flex;/)
})

test('title-bar buttons keep the compact, ball, reset order and the drag wiring', () => {
  // The actions are data driven: ids are declared in order and rendered through
  // one `data-qn-action` attribute (the DOM order is covered by window.test).
  const compactIndex = SOURCE.indexOf("id: 'compact'")
  const ballIndex = SOURCE.indexOf("id: 'ball'")
  const resetIndex = SOURCE.indexOf("id: 'reset'")
  assert.notEqual(compactIndex, -1, 'compact action is missing')
  assert.notEqual(ballIndex, -1, 'ball action is missing')
  assert.notEqual(resetIndex, -1, 'reset action is missing')
  assert.ok(compactIndex < ballIndex, 'compact action must come before the ball action')
  assert.ok(ballIndex < resetIndex, 'ball action must come before the reset action')
  assert.match(SOURCE, /'data-qn-action': action\.id/)
  assert.match(SOURCE, /onPointerDown: beginGesture\('move'\)/)
  assert.match(SOURCE, /onPointerDown: beginGesture\('resize', handle\)/)
  assert.match(SOURCE, /RESIZE_HANDLES\.map/)
  assert.match(SOURCE, /setPointerCapture\(event\.pointerId\)/)
  assert.match(SOURCE, /requestAnimationFrame/)
})

test('reset button forwards to the store action with localized labels', () => {
  assert.match(SOURCE, /onClick: resetSize/)
  assert.match(SOURCE, /label: t\('window\.resetSize'\)/)
  assert.match(SOURCE, /actions\.resetWindowSize/)
  assert.match(SOURCE, /function resetSize\(\)/)
})

test('window stylesheet keeps the token and class discipline', () => {
  const css = windowModule.CSS
  assert.ok(css.includes('--dsw-alias-'), 'styles must use theme tokens')
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'no hard-coded hex colors')
  assert.doesNotMatch(css, /\brgb\(/, 'only rgba() black shadows are allowed')
  for (const match of css.matchAll(/rgba\(([^)]*)\)/g)) {
    assert.match(
      match[0],
      /^rgba\(\s*0,\s*0,\s*0,\s*[\d.]+\)$/,
      `shadows must be black: ${match[0]}`,
    )
  }
  for (const match of css.matchAll(/var\(([^)]+)\)/g)) {
    assert.match(match[1], /^--dsw-alias-[a-z0-9-]+$/, `unknown CSS variable: ${match[1]}`)
  }
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const classNames = [...selectors.matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1])
  assert.ok(classNames.length > 0, 'stylesheet must declare classes')
  for (const className of classNames) {
    assert.ok(className.startsWith('qn-'), `CSS class must be qn-prefixed: ${className}`)
  }
})
