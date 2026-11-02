/**
 * Smoke test for the generated Client bundle.
 *
 * Evaluates `client.js` in a bare VM with a stub module loader and a stub
 * React, then applies the plugin and asserts both slot registrations. This
 * catches module-level crashes and a broken loader wrapper without a browser.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Build the smallest React surface the bundle needs at module scope.
 * @returns the stub React module.
 */
function fakeReact() {
  return {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Fragment: Symbol('Fragment'),
    Component: class Component {
      constructor(props) {
        this.props = props
      }
    },
    useRef: (value) => ({ current: value }),
    useState: (value) => [value, () => {}],
    useEffect: () => {},
    useSyncExternalStore: () => ({}),
  }
}

/**
 * Build the DOM surface the plugin entry touches.
 * @returns `{ document, removed }`.
 */
function fakeDocument() {
  const removed = []
  const style = {
    textContent: '',
    setAttribute() {},
    remove() {
      removed.push(true)
    },
  }
  return {
    removed,
    document: {
      createElement: () => style,
      head: { appendChild() {} },
    },
  }
}

test('client.js registers the plugin and both slots', async () => {
  const source = await readFile(join(PACKAGE_ROOT, 'client.js'), 'utf8')
  assert.match(source, /window\.__ModuleLoader__\.load\(/)

  const loaded = []
  const registrations = []
  const localeRegistrations = []
  const cleanups = []
  const { document, removed } = fakeDocument()

  const sandbox = {
    console,
    window: {
      __ModuleLoader__: {
        load(definition) {
          loaded.push(definition)
        },
      },
      addEventListener() {},
      removeEventListener() {},
      innerWidth: 1280,
      innerHeight: 800,
      setTimeout: () => 0,
      clearTimeout: () => {},
    },
    document,
    setTimeout: () => 0,
    clearTimeout: () => {},
    fetch: async () => {
      throw new Error('offline')
    },
    URL,
    Blob,
    navigator: { language: 'zh-CN' },
    __PLUGIN_VERSION__: '1.0.0',
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })

  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'dsh-quick-notes')
  const plugin = loaded[0].factory((request) => {
    assert.equal(request, 'react')
    return fakeReact()
  })
  assert.ok(Array.isArray(plugin.inject))
  assert.ok(plugin.inject.includes('slots'))
  assert.ok(plugin.inject.includes('locale'))

  const ctx = {
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') cleanups.push(dispose)
      return dispose
    },
    slots: {
      inject(key, callback) {
        assert.equal(typeof key, 'string')
        callback()
        return () => {}
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
    locale: {
      register(namespace, dictionaries) {
        localeRegistrations.push({ namespace, dictionaries })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)

  assert.deepEqual(
    localeRegistrations.map((entry) => entry.namespace),
    ['quickNotes'],
  )
  const overlay = registrations.find((entry) => entry.options.name === 'shell.overlay')
  assert.ok(overlay, 'shell.overlay registration is missing')
  assert.equal(overlay.options.id, 'quick-notes-window')
  assert.equal(overlay.options.locale, 'quickNotes')
  const launcher = registrations.find((entry) => entry.options.name === 'sidebar.footer.action')
  assert.ok(launcher, 'sidebar.footer.action registration is missing')
  assert.equal(launcher.options.id, 'quick-notes-launcher')

  // The style injection must be owned by an effect with a working cleanup.
  assert.equal(removed.length, 0)
  for (const cleanup of cleanups) cleanup()
  assert.equal(removed.length, 1)
})
