/**
 * Unit tests for the directory column and the panels it hosts.
 *
 * Two layers:
 * - pure helpers (drop math, relative time, confirm state machine, sync/theme
 *   keys, settings stepping) tested directly;
 * - a small jsdom + react-dom layer that drives the real component through the
 *   pointer drag gesture, the footer toggles and the theme picker.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import React from 'react'
import { createInitialState, THEMES } from '../../src/shared/model.js'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'http://127.0.0.1:58587/',
})

globalThis.window = dom.window
globalThis.document = dom.window.document
// Node exposes `navigator` as a getter-only global; replace its descriptor.
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
globalThis.PointerEvent = dom.window.PointerEvent
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { createRoot } = await import('react-dom/client')
const { act } = React
const h = React.createElement

const sidebar = await import(
  new URL('../../src/client/components/sidebar.js', import.meta.url).href
)
const settings = await import(
  new URL('../../src/client/components/settings.js', import.meta.url).href
)
const trash = await import(new URL('../../src/client/components/trash.js', import.meta.url).href)

/** Modules contributing copy and styles to the directory column. */
const MODULES = [
  { name: 'sidebar', module: sidebar },
  { name: 'settings', module: settings },
  { name: 'trash', module: trash },
]

/** Copy prefixes allowed on the directory column's keys. */
const ALLOWED_PREFIXES = ['sidebar.', 'settings.', 'trash.', 'note.', 'sync.']

/** Fake translator backed by a dictionary, for `describeMessage` tests. */
const fakeT = (dictionary) => (key) => dictionary[key] ?? key

/** Component translator: keys survive, params are serialised for assertions. */
function t(key, params) {
  return params === undefined ? key : `${key}${JSON.stringify(params)}`
}

/**
 * List `{placeholder}` tokens in a translation string.
 * @param text - translation string.
 * @returns the sorted placeholder tokens.
 */
function placeholders(text) {
  return [...text.matchAll(/\{[a-z]+\}/g)].map((match) => match[0]).sort()
}

// ------------------------------------------------------------------ helpers

/**
 * Build one note.
 * @param id - note id.
 * @param title - title.
 * @param pinned - pin flag.
 * @returns the note object.
 */
function makeNote(id, title, pinned = false) {
  return { id, title, html: '', pinned, createdAt: 1000, updatedAt: 1000 }
}

/**
 * Build a full runtime state around the given notes.
 * @param notes - display notes.
 * @param overrides - state overrides.
 * @returns the state object.
 */
function makeState(notes, overrides = {}) {
  return {
    ...createInitialState(1_700_000_000_000),
    notes,
    activeId: notes[0]?.id ?? null,
    ready: true,
    sync: { phase: 'synced', at: 0 },
    ...overrides,
  }
}

/**
 * Spy collector for the actions the tests exercise.
 * @returns the spies object.
 */
function makeSpies() {
  return {
    selectNote: [],
    setView: [],
    updateSettings: [],
    moveNote: [],
    resetWindowPosition: [],
    createNote: [],
    renameNote: [],
    togglePin: [],
    trashNote: [],
    restoreNote: [],
    purgeNote: [],
    emptyTrash: [],
  }
}

/**
 * Build the action surface the components expect.
 * @param spies - spy collector.
 * @returns the actions object.
 */
function makeActions(spies) {
  return {
    createNote: (title) => {
      spies.createNote.push(title)
      return 'n_created'
    },
    renameNote: (id, title) => spies.renameNote.push([id, title]),
    setNoteHtml: () => {},
    togglePin: (id) => spies.togglePin.push(id),
    trashNote: (id) => spies.trashNote.push(id),
    restoreNote: (id) => spies.restoreNote.push(id),
    purgeNote: (id) => spies.purgeNote.push(id),
    emptyTrash: () => spies.emptyTrash.push(true),
    selectNote: (id) => spies.selectNote.push(id),
    setView: (view) => spies.setView.push(view),
    updateSettings: (patch) => spies.updateSettings.push(patch),
    updateUi: () => {},
    setMode: () => {},
    moveNote: (id, toIndex) => spies.moveNote.push([id, toIndex]),
    resetWindowPosition: () => spies.resetWindowPosition.push(true),
    importState: () => ({ ok: true }),
    exportState: () => ({}),
    flush: () => Promise.resolve(),
  }
}

/**
 * Mount a React element into a detached jsdom container.
 * @param element - React element.
 * @returns the mounted view.
 */
function mount(element) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return {
    container,
    unmount() {
      act(() => root.unmount())
      container.remove()
    },
  }
}

/**
 * Build a DOMRect-like object for getBoundingClientRect stubs.
 * @param top - viewport top.
 * @param height - height.
 * @returns the rectangle.
 */
function rectOf(top, height) {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 160,
    bottom: top + height,
    width: 160,
    height,
    toJSON: () => ({}),
  }
}

/**
 * jsdom has no layout, so give the list and its rows synthetic geometry.
 * @param container - mounted container.
 */
function stubListGeometry(container) {
  const list = container.querySelector('ul[data-qn-note-list]')
  list.getBoundingClientRect = () => rectOf(90, 260)
  for (const row of container.querySelectorAll('li[data-qn-note-id]')) {
    row.getBoundingClientRect = () => {
      const order = [...container.querySelectorAll('li[data-qn-note-id]')]
      return rectOf(100 + order.indexOf(row) * 30, 26)
    }
  }
}

/**
 * Dispatch one pointer event inside `act`.
 * @param element - event target.
 * @param type - event type.
 * @param init - PointerEvent init overrides.
 */
function firePointer(element, type, init = {}) {
  act(() => {
    element.dispatchEvent(
      new window.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        ...init,
      }),
    )
  })
}

/**
 * Type into a controlled input the way React observes it (native value setter
 * plus an `input` event).
 * @param input - text input.
 * @param value - next value.
 */
function typeInto(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

/**
 * Dispatch one keyboard event inside `act`.
 * @param element - event target.
 * @param key - key value.
 * @param init - KeyboardEvent init overrides.
 */
function pressKey(element, key, init = {}) {
  act(() => {
    element.dispatchEvent(
      new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    )
  })
}

/**
 * Dispatch a focusout event (React's `onBlur`) inside `act`.
 * @param element - event target.
 */
function blur(element) {
  act(() => {
    element.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }))
  })
}

/**
 * Harness that re-renders when `moveNote` reorders the notes, like the store.
 * @param props - initial notes and spies.
 * @returns the sidebar element.
 */
function DragHarness({ initialNotes, spies }) {
  const [notes, setNotes] = React.useState(initialNotes)
  const actions = React.useMemo(
    () => ({
      ...makeActions(spies),
      moveNote(id, toIndex) {
        spies.moveNote.push([id, toIndex])
        setNotes((current) => {
          const from = current.findIndex((note) => note.id === id)
          if (from < 0) return current
          const next = current.slice()
          const [note] = next.splice(from, 1)
          next.splice(toIndex, 0, note)
          return next
        })
      },
    }),
    [spies],
  )
  const state = React.useMemo(() => makeState(notes), [notes])
  return h(sidebar.Sidebar, { t, state, actions })
}

// ------------------------------------------------------------------ pure helpers

test('component modules export the contract', () => {
  assert.equal(typeof sidebar.Sidebar, 'function')
  assert.equal(typeof settings.SettingsPanel, 'function')
  assert.equal(typeof trash.TrashPanel, 'function')
  for (const { name, module } of MODULES) {
    assert.equal(typeof module.CSS, 'string', `${name} must export CSS`)
    assert.ok(module.CSS.trim() !== '', `${name} CSS must not be empty`)
    assert.equal(typeof module.I18N, 'object', `${name} must export I18N`)
  }
  // Shared helpers live in their owning module (settings.js / trash.js) and the
  // drag helpers in the directory module itself.
  assert.equal(typeof trash.formatRelativeTime, 'function')
  assert.equal(typeof trash.nextConfirmState, 'function')
  assert.equal(typeof settings.syncLabelKey, 'function')
  assert.equal(trash.CONFIRM_RESET_MS, 3000)
  assert.equal(sidebar.DRAG_THRESHOLD_PX, 4)
  assert.equal(sidebar.DRAG_ANIMATION_MS, 160)
  assert.equal(typeof sidebar.computeDropIndex, 'function')
  assert.equal(typeof sidebar.computeRowShift, 'function')
  assert.equal(typeof sidebar.clampIndexWithinGroup, 'function')
  assert.equal(typeof sidebar.exceedsDragThreshold, 'function')
})

test('stylesheets use qn- classes and theme tokens only', () => {
  for (const { name, module } of MODULES) {
    const css = module.CSS
    assert.ok(
      css.includes('--dsw-alias-'),
      `${name} CSS must color surfaces through --dsw-alias-* tokens`,
    )
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, `${name} CSS must not hard-code hex colors`)
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const classNames = [...selectors.matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1])
    assert.ok(classNames.length > 0, `${name} CSS must declare classes`)
    for (const className of classNames) {
      assert.ok(className.startsWith('qn-'), `${name} CSS class must be qn-prefixed: ${className}`)
    }
  }
})

test('i18n dictionaries are symmetric, prefixed and fully translated', () => {
  for (const { name, module } of MODULES) {
    const en = module.I18N.en
    const zh = module.I18N.zh
    assert.equal(typeof en, 'object', `${name} must ship English copy`)
    assert.equal(typeof zh, 'object', `${name} must ship Chinese copy`)
    const enKeys = Object.keys(en).sort()
    const zhKeys = Object.keys(zh).sort()
    assert.deepEqual(zhKeys, enKeys, `${name} en/zh keys must match`)
    for (const key of enKeys) {
      assert.ok(
        ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix)),
        `${name} has an unexpected key prefix: ${key}`,
      )
      assert.equal(typeof en[key], 'string')
      assert.equal(typeof zh[key], 'string')
      assert.ok(en[key].trim() !== '', `${name}:${key} English copy is empty`)
      assert.ok(zh[key].trim() !== '', `${name}:${key} Chinese copy is empty`)
      assert.deepEqual(
        placeholders(zh[key]),
        placeholders(en[key]),
        `${name}:${key} placeholders differ between locales`,
      )
    }
  }
})

test('exceedsDragThreshold only starts after four pixels', () => {
  assert.equal(sidebar.exceedsDragThreshold(0, 0), false)
  assert.equal(sidebar.exceedsDragThreshold(3, 0), false)
  assert.equal(sidebar.exceedsDragThreshold(0, 3), false)
  assert.equal(sidebar.exceedsDragThreshold(0, 4), true)
  assert.equal(sidebar.exceedsDragThreshold(3, 3), true)
  assert.equal(sidebar.exceedsDragThreshold(-5, 0), true)
})

test('clampIndexWithinGroup keeps an index inside its group', () => {
  assert.equal(sidebar.clampIndexWithinGroup(-5, 2, 3), 2)
  assert.equal(sidebar.clampIndexWithinGroup(2, 2, 3), 2)
  assert.equal(sidebar.clampIndexWithinGroup(3.4, 2, 3), 3)
  assert.equal(sidebar.clampIndexWithinGroup(9, 2, 3), 4)
  assert.equal(sidebar.clampIndexWithinGroup(Number.NaN, 2, 3), 2)
  assert.equal(sidebar.clampIndexWithinGroup(4, 0, 1), 0)
})

test('computeDropIndex never leaves the pinned/unpinned group', () => {
  const rows = [
    { id: 'p1', top: 0, height: 26, pinned: true },
    { id: 'p2', top: 30, height: 26, pinned: true },
    { id: 'a', top: 60, height: 26, pinned: false },
    { id: 'b', top: 90, height: 26, pinned: false },
    { id: 'c', top: 120, height: 26, pinned: false },
  ]
  // Dragging a normal note above everything clamps to the first normal slot.
  assert.equal(sidebar.computeDropIndex(rows, -100, 'a'), 2)
  assert.equal(sidebar.computeDropIndex(rows, -100, 'b'), 2)
  // Dragging below everything clamps to the last slot.
  assert.equal(sidebar.computeDropIndex(rows, 1000, 'a'), 4)
  assert.equal(sidebar.computeDropIndex(rows, 1000, 'b'), 4)
  // Mid-list moves: swap with the neighbour whose centre is passed.
  assert.equal(sidebar.computeDropIndex(rows, 150, 'a'), 4)
  assert.equal(sidebar.computeDropIndex(rows, 20, 'c'), 2)
  assert.equal(sidebar.computeDropIndex(rows, 73, 'a'), 2)
  // Pinned notes clamp to the pinned group only.
  assert.equal(sidebar.computeDropIndex(rows, -100, 'p2'), 0)
  assert.equal(sidebar.computeDropIndex(rows, 1000, 'p2'), 1)
  // Unknown ids and single-row groups are safe.
  assert.equal(sidebar.computeDropIndex(rows, 0, 'missing'), 0)
  assert.equal(
    sidebar.computeDropIndex([{ id: 'x', top: 0, height: 26, pinned: false }], 999, 'x'),
    0,
  )
})

test('computeRowShift opens the gap at the drop target', () => {
  assert.equal(sidebar.computeRowShift(0, 0, 2, 30), 0)
  assert.equal(sidebar.computeRowShift(1, 0, 2, 30), -30)
  assert.equal(sidebar.computeRowShift(2, 0, 2, 30), -30)
  assert.equal(sidebar.computeRowShift(3, 0, 2, 30), 0)
  assert.equal(sidebar.computeRowShift(0, 2, 1, 30), 0)
  assert.equal(sidebar.computeRowShift(1, 2, 1, 30), 30)
  assert.equal(sidebar.computeRowShift(2, 2, 1, 30), 0)
  assert.equal(sidebar.computeRowShift(1, 1, 3, 30), 0)
  assert.equal(sidebar.computeRowShift(2, 1, 3, 30), -30)
  assert.equal(sidebar.computeRowShift(0, 2, 2, 30), 0)
})

test('syncLabelKey maps every documented phase', () => {
  const phases = ['loading', 'local', 'syncing', 'synced', 'error']
  assert.deepEqual(Object.keys(settings.SYNC_LABEL_KEYS).sort(), phases.slice().sort())
  for (const phase of phases) {
    const key = settings.syncLabelKey(phase)
    assert.equal(key, settings.SYNC_LABEL_KEYS[phase])
    assert.ok(settings.I18N.en[key] !== undefined, `missing en copy for ${key}`)
    assert.ok(settings.I18N.zh[key] !== undefined, `missing zh copy for ${key}`)
  }
  assert.equal(settings.syncLabelKey('unknown-phase'), 'sync.local')
  assert.equal(settings.syncLabelKey(undefined), 'sync.local')
})

test('themeLabelKey maps every theme option', () => {
  assert.deepEqual(Object.keys(settings.THEME_LABEL_KEYS).sort(), [...THEMES].sort())
  for (const theme of THEMES) {
    const key = settings.themeLabelKey(theme)
    assert.equal(key, settings.THEME_LABEL_KEYS[theme])
    assert.ok(settings.I18N.en[key] !== undefined, `missing en copy for ${key}`)
    assert.ok(settings.I18N.zh[key] !== undefined, `missing zh copy for ${key}`)
  }
  assert.equal(settings.themeLabelKey('unknown'), 'settings.themeSystem')
})

test('formatRelativeTime buckets deletion times', () => {
  const now = 1_700_000_000_000
  const cases = [
    [now, { key: 'trash.timeJustNow', n: 0 }],
    [now - 59_000, { key: 'trash.timeJustNow', n: 0 }],
    [now - 60_000, { key: 'trash.timeMinutesAgo', n: 1 }],
    [now + 5_000, { key: 'trash.timeJustNow', n: 0 }],
    [now - 59 * 60_000, { key: 'trash.timeMinutesAgo', n: 59 }],
    [now - 60 * 60_000, { key: 'trash.timeHoursAgo', n: 1 }],
    [now - 23 * 3_600_000, { key: 'trash.timeHoursAgo', n: 23 }],
    [now - 24 * 3_600_000, { key: 'trash.timeDaysAgo', n: 1 }],
    [now - 29 * 86_400_000, { key: 'trash.timeDaysAgo', n: 29 }],
    [now - 30 * 86_400_000, { key: 'trash.timeMonthsAgo', n: 1 }],
    [now - 364 * 86_400_000, { key: 'trash.timeMonthsAgo', n: 12 }],
    [now - 365 * 86_400_000, { key: 'trash.timeYearsAgo', n: 1 }],
    [now - 800 * 86_400_000, { key: 'trash.timeYearsAgo', n: 2 }],
  ]
  for (const [timestamp, expected] of cases) {
    const descriptor = trash.formatRelativeTime(timestamp, now)
    assert.deepEqual(descriptor, expected, `timestamp ${now - timestamp}ms before now`)
    assert.ok(trash.I18N.en[descriptor.key] !== undefined)
    assert.ok(trash.I18N.zh[descriptor.key] !== undefined)
  }
  assert.deepEqual(trash.formatRelativeTime(Number.NaN, now), {
    key: 'trash.timeUnknown',
    n: 0,
  })
  assert.deepEqual(trash.formatRelativeTime(undefined, now), {
    key: 'trash.timeUnknown',
    n: 0,
  })
})

test('nextConfirmState arms, confirms, expires and retargets', () => {
  const now = 10_000
  const armed = trash.nextConfirmState(null, 'n1', now)
  assert.deepEqual(armed, { id: 'n1', at: now, confirmed: false })

  const confirmed = trash.nextConfirmState(armed, 'n1', now + 999)
  assert.deepEqual(confirmed, { id: 'n1', at: now + 999, confirmed: true })

  const expired = trash.nextConfirmState(armed, 'n1', now + trash.CONFIRM_RESET_MS)
  assert.equal(expired.confirmed, false, 'an expired arm must not confirm')
  assert.equal(expired.id, 'n1')
  assert.equal(expired.at, now + trash.CONFIRM_RESET_MS)

  const retargeted = trash.nextConfirmState(armed, 'n2', now + 10)
  assert.deepEqual(retargeted, { id: 'n2', at: now + 10, confirmed: false })
})

test('stepSetting steps, rounds floating point and clamps', () => {
  const font = { min: 13, max: 20, step: 1 }
  const line = { min: 1.4, max: 2, step: 0.05 }
  assert.equal(settings.stepSetting(15, 1, font), 16)
  assert.equal(settings.stepSetting(20, 1, font), 20)
  assert.equal(settings.stepSetting(13, -1, font), 13)
  assert.equal(settings.stepSetting(1.45, 1, line), 1.5)
  assert.equal(settings.stepSetting(1.75, 1, line), 1.8)
  assert.equal(settings.stepSetting(1.75, -1, line), 1.7)
  assert.equal(settings.stepSetting(1.99, 1, line), 2)
  assert.equal(settings.stepSetting(2, 1, line), 2)
  assert.equal(settings.stepSetting(1.4, -1, line), 1.4)
})

test('exportFileName stamps a sortable date', () => {
  assert.equal(settings.exportFileName(new Date(2026, 10, 1, 9, 30)), 'quick-notes-2026-11-01.json')
  assert.equal(settings.exportFileName(new Date(2026, 0, 5)), 'quick-notes-2026-01-05.json')
  assert.match(
    settings.exportFileName(new Date('not a date')),
    /^quick-notes-\d{4}-\d{2}-\d{2}\.json$/,
  )
})

test('translatedMessage only surfaces real translation keys', () => {
  const t = fakeT({ 'sync.error': 'Sync failed', 'limit.notes': 'The directory is full.' })
  assert.equal(settings.translatedMessage(t, undefined), null)
  assert.equal(settings.translatedMessage(t, null), null)
  assert.equal(settings.translatedMessage(t, ''), null)
  assert.equal(settings.translatedMessage(t, 'host'), null)
  assert.equal(settings.translatedMessage(t, 'missing.key'), null)
  assert.equal(settings.translatedMessage(t, 7), null)
  assert.equal(settings.translatedMessage(t, 'sync.error'), 'Sync failed')
})

test('describeMessage resolves store keys and keeps plain diagnostics', () => {
  const t = fakeT({ 'limit.notes': 'The directory is full.' })
  assert.equal(settings.describeMessage(t, undefined), null)
  assert.equal(settings.describeMessage(t, null), null)
  assert.equal(settings.describeMessage(t, '   '), null)
  assert.equal(settings.describeMessage(t, 42), null)
  assert.equal(settings.describeMessage(t, 'limit.notes'), 'The directory is full.')
  assert.equal(settings.describeMessage(t, 'missing.key'), 'missing.key')
  assert.equal(settings.describeMessage(t, 'disk is full'), 'disk is full')
})

// ------------------------------------------------------------------ jsdom interactions

test('pointer drag reorders rows through moveNote and swallows the click', () => {
  const spies = makeSpies()
  const notes = [makeNote('a', 'A'), makeNote('b', 'B'), makeNote('c', 'C')]
  const view = mount(h(DragHarness, { initialNotes: notes, spies }))
  try {
    stubListGeometry(view.container)
    const rowOf = (id) => view.container.querySelector(`li[data-qn-note-id='${id}']`)
    const selectOf = (id) => rowOf(id).querySelector('button[data-qn-select]')

    firePointer(selectOf('a'), 'pointerdown', { clientX: 10, clientY: 105 })
    firePointer(rowOf('a'), 'pointermove', { clientX: 10, clientY: 140, buttons: 1 })
    firePointer(rowOf('a'), 'pointermove', { clientX: 10, clientY: 190, buttons: 1 })
    firePointer(rowOf('a'), 'pointerup', { clientX: 10, clientY: 190 })

    assert.deepEqual(spies.moveNote, [['a', 2]], 'drop must commit the moved index')
    const order = [...view.container.querySelectorAll('li[data-qn-note-id]')].map((row) =>
      row.getAttribute('data-qn-note-id'),
    )
    assert.deepEqual(order, ['b', 'c', 'a'], 'the store order must be replayed')

    // The click that follows the drag belongs to the gesture, not to selection.
    act(() => selectOf('a').click())
    assert.deepEqual(spies.selectNote, [])
    // …and the following click selects normally again.
    act(() => selectOf('a').click())
    assert.deepEqual(spies.selectNote, ['a'])
  } finally {
    view.unmount()
  }
})

test('a pointer move under the threshold stays a plain click', () => {
  const spies = makeSpies()
  const notes = [makeNote('a', 'A'), makeNote('b', 'B')]
  const view = mount(h(DragHarness, { initialNotes: notes, spies }))
  try {
    stubListGeometry(view.container)
    const rowOf = (id) => view.container.querySelector(`li[data-qn-note-id='${id}']`)
    firePointer(rowOf('a').querySelector('button[data-qn-select]'), 'pointerdown', {
      clientX: 10,
      clientY: 105,
    })
    firePointer(rowOf('a'), 'pointermove', { clientX: 10, clientY: 107 })
    firePointer(rowOf('a'), 'pointerup', { clientX: 10, clientY: 107 })
    assert.deepEqual(spies.moveNote, [])
    act(() => rowOf('a').querySelector('button[data-qn-select]').click())
    assert.deepEqual(spies.selectNote, ['a'])
  } finally {
    view.unmount()
  }
})

test('dragging across the pinned boundary clamps to the group', () => {
  const spies = makeSpies()
  const notes = [
    makeNote('p1', 'Pinned', true),
    makeNote('a', 'A'),
    makeNote('b', 'B'),
    makeNote('c', 'C'),
  ]
  const view = mount(h(DragHarness, { initialNotes: notes, spies }))
  try {
    stubListGeometry(view.container)
    const rowOf = (id) => view.container.querySelector(`li[data-qn-note-id='${id}']`)
    firePointer(rowOf('c').querySelector('button[data-qn-select]'), 'pointerdown', {
      clientX: 10,
      clientY: 165,
    })
    firePointer(rowOf('c'), 'pointermove', { clientX: 10, clientY: 40, buttons: 1 })
    // Preview: the dragged row follows the pointer and the rows below it open
    // the target gap instead of jumping on release.
    assert.equal(rowOf('c').getAttribute('data-dragging'), 'true')
    assert.match(rowOf('c').style.transform, /^translateY\(/)
    assert.equal(rowOf('b').style.transform, 'translateY(30px)')
    firePointer(rowOf('c'), 'pointermove', { clientX: 10, clientY: 0, buttons: 1 })
    firePointer(rowOf('c'), 'pointerup', { clientX: 10, clientY: 0 })
    assert.equal(rowOf('c').getAttribute('data-dragging'), null)

    // Display index 1 is the first unpinned slot: never above the pinned row.
    assert.deepEqual(spies.moveNote, [['c', 1]])
    const order = [...view.container.querySelectorAll('li[data-qn-note-id]')].map((row) =>
      row.getAttribute('data-qn-note-id'),
    )
    assert.deepEqual(order, ['p1', 'c', 'a', 'b'])
  } finally {
    view.unmount()
  }
})

test('Alt+Arrow reorders the focused row inside its group', () => {
  const spies = makeSpies()
  const notes = [makeNote('p1', 'Pinned', true), makeNote('a', 'A'), makeNote('b', 'B')]
  const view = mount(h(DragHarness, { initialNotes: notes, spies }))
  try {
    const selectOf = (id) =>
      view.container.querySelector(`li[data-qn-note-id='${id}'] button[data-qn-select]`)
    pressKey(selectOf('a'), 'ArrowDown', { altKey: true })
    assert.deepEqual(spies.moveNote, [['a', 2]])
    pressKey(selectOf('p1'), 'ArrowUp', { altKey: true })
    assert.deepEqual(
      spies.moveNote,
      [['a', 2]],
      'the only pinned note cannot reorder above the group',
    )
  } finally {
    view.unmount()
  }
})

test('double-click still opens the rename input', () => {
  const spies = makeSpies()
  const notes = [makeNote('a', 'A'), makeNote('b', 'B')]
  const view = mount(
    h(sidebar.Sidebar, { t, state: makeState(notes), actions: makeActions(spies) }),
  )
  try {
    const select = view.container.querySelector(`li[data-qn-note-id='a'] button[data-qn-select]`)
    act(() => {
      const init = { bubbles: true, cancelable: true, pointerId: 1, button: 0 }
      select.dispatchEvent(new window.PointerEvent('pointerdown', init))
      select.dispatchEvent(new window.PointerEvent('pointerup', init))
      select.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))
    })
    assert.ok(
      view.container.querySelector(`input[data-qn-rename='a']`),
      'the double-click must still enter rename mode',
    )
  } finally {
    view.unmount()
  }
})

test('new note draft focuses and commits on Enter', () => {
  const spies = makeSpies()
  const view = mount(
    h(sidebar.Sidebar, {
      t,
      state: makeState([makeNote('a', 'A')]),
      actions: makeActions(spies),
    }),
  )
  try {
    act(() => view.container.querySelector('button[data-qn-new]').click())
    const input = view.container.querySelector('input[aria-label="sidebar.newNote"]')
    assert.ok(input, 'the draft input must appear')
    assert.equal(document.activeElement, input, 'the draft input must be focused')
    typeInto(input, '  Fresh note  ')
    pressKey(input, 'Enter')
    assert.deepEqual(spies.createNote, ['Fresh note'])
    assert.deepEqual(spies.selectNote, ['n_created'])
    assert.equal(view.container.querySelector('input[aria-label="sidebar.newNote"]'), null)
  } finally {
    view.unmount()
  }
})

test('draft Escape cancels and blank blur creates nothing', () => {
  const spies = makeSpies()
  const view = mount(
    h(sidebar.Sidebar, {
      t,
      state: makeState([makeNote('a', 'A')]),
      actions: makeActions(spies),
    }),
  )
  try {
    const openDraft = () => act(() => view.container.querySelector('button[data-qn-new]').click())
    const draftInput = () => view.container.querySelector('input[aria-label="sidebar.newNote"]')
    openDraft()
    typeInto(draftInput(), 'discarded')
    pressKey(draftInput(), 'Escape')
    assert.deepEqual(spies.createNote, [], 'Escape must not create a note')
    openDraft()
    blur(draftInput())
    assert.deepEqual(spies.createNote, [], 'a blank blur must not create a note')
    openDraft()
    typeInto(draftInput(), 'Blurred')
    blur(draftInput())
    assert.deepEqual(spies.createNote, ['Blurred'], 'a filled blur commits the draft')
  } finally {
    view.unmount()
  }
})

test('rename input commits on Enter and cancels on Escape', () => {
  const spies = makeSpies()
  const view = mount(
    h(sidebar.Sidebar, {
      t,
      state: makeState([makeNote('a', 'A'), makeNote('b', 'B')]),
      actions: makeActions(spies),
    }),
  )
  try {
    const selectOf = (id) =>
      view.container.querySelector(`li[data-qn-note-id='${id}'] button[data-qn-select]`)
    const renameInput = () => view.container.querySelector(`input[data-qn-rename='a']`)
    act(() => selectOf('a').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })))
    assert.ok(renameInput(), 'the rename input must appear')
    assert.equal(renameInput().value, 'A', 'the input starts with the current title')
    assert.equal(document.activeElement, renameInput(), 'the rename input must be focused')
    typeInto(renameInput(), 'Renamed')
    pressKey(renameInput(), 'Enter')
    assert.deepEqual(spies.renameNote, [['a', 'Renamed']])
    act(() => selectOf('a').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })))
    typeInto(renameInput(), 'discarded')
    pressKey(renameInput(), 'Escape')
    assert.deepEqual(spies.renameNote, [['a', 'Renamed']], 'Escape must not rename')
    // F2 is the keyboard shortcut for the same rename input.
    pressKey(selectOf('a'), 'F2')
    assert.ok(renameInput(), 'F2 must open the rename input')
  } finally {
    view.unmount()
  }
})

test('footer ruled-lines toggle writes the setting', () => {
  const spies = makeSpies()
  const off = mount(
    h(sidebar.Sidebar, {
      t,
      state: makeState([makeNote('a', 'A')]),
      actions: makeActions(spies),
    }),
  )
  try {
    const button = off.container.querySelector('button[data-qn-ruled-lines]')
    assert.equal(button.getAttribute('title'), 'sidebar.ruledLines')
    assert.equal(button.getAttribute('aria-label'), 'sidebar.ruledLines')
    assert.equal(button.getAttribute('aria-pressed'), 'false')
    act(() => button.click())
    assert.deepEqual(spies.updateSettings, [{ ruledLines: true }])
  } finally {
    off.unmount()
  }

  const on = mount(
    h(sidebar.Sidebar, {
      t,
      state: makeState([makeNote('a', 'A')], {
        settings: { ...createInitialState().settings, ruledLines: true },
      }),
      actions: makeActions(spies),
    }),
  )
  try {
    const button = on.container.querySelector('button[data-qn-ruled-lines]')
    assert.equal(button.getAttribute('aria-pressed'), 'true')
  } finally {
    on.unmount()
  }
})

test('theme picker writes settings.theme', () => {
  const spies = makeSpies()
  const view = mount(
    h(sidebar.Sidebar, {
      t,
      state: makeState([], { view: 'settings' }),
      actions: makeActions(spies),
    }),
  )
  try {
    const buttons = [...view.container.querySelectorAll('button[data-qn-theme]')]
    assert.deepEqual(
      buttons.map((button) => button.getAttribute('data-qn-theme')),
      [...THEMES],
    )
    const byTheme = (theme) => view.container.querySelector(`button[data-qn-theme='${theme}']`)
    assert.equal(byTheme('system').getAttribute('aria-pressed'), 'true')
    assert.equal(byTheme('light').getAttribute('aria-pressed'), 'false')
    act(() => byTheme('dark').click())
    assert.deepEqual(spies.updateSettings, [{ theme: 'dark' }])
  } finally {
    view.unmount()
  }
})

test('reset window position button calls the store action', () => {
  const spies = makeSpies()
  const view = mount(
    h(sidebar.Sidebar, {
      t,
      state: makeState([], { view: 'settings' }),
      actions: makeActions(spies),
    }),
  )
  try {
    const button = view.container.querySelector('button[data-qn-reset-position]')
    assert.ok(button, 'the settings panel must render the reset-position button')
    assert.equal(button.getAttribute('title'), 'settings.resetPosition')
    assert.equal(button.getAttribute('aria-label'), 'settings.resetPosition')
    assert.equal(button.textContent, 'settings.resetPosition')
    assert.deepEqual(spies.resetWindowPosition, [])
    act(() => button.click())
    assert.deepEqual(spies.resetWindowPosition, [true], 'the click must reset the window position')
  } finally {
    view.unmount()
  }
})

test('reset window position button is only part of the settings view', () => {
  const spies = makeSpies()
  const view = mount(
    h(sidebar.Sidebar, {
      t,
      state: makeState([makeNote('a', 'A')]),
      actions: makeActions(spies),
    }),
  )
  try {
    assert.equal(view.container.querySelector('button[data-qn-reset-position]'), null)
  } finally {
    view.unmount()
  }
})

test('font and line-height steppers write the settings', () => {
  const spies = makeSpies()
  const view = mount(
    h(sidebar.Sidebar, {
      t,
      state: makeState([], { view: 'settings' }),
      actions: makeActions(spies),
    }),
  )
  try {
    const steppers = [...view.container.querySelectorAll('button.qn-stepper-button')]
    assert.equal(steppers.length, 4, 'two steppers (decrease/increase) per numeric setting')
    act(() => steppers[0].click())
    assert.deepEqual(spies.updateSettings, [{ fontSize: 14 }])
    act(() => steppers[3].click())
    assert.deepEqual(spies.updateSettings, [{ fontSize: 14 }, { lineHeight: 1.8 }])
  } finally {
    view.unmount()
  }
})

test('row actions and footer navigation still call the store actions', () => {
  const spies = makeSpies()
  const notes = [makeNote('a', 'A'), makeNote('b', 'B')]
  const view = mount(
    h(sidebar.Sidebar, {
      t,
      state: makeState(notes, { activeId: 'a' }),
      actions: makeActions(spies),
    }),
  )
  try {
    const rowOf = (id) => view.container.querySelector(`li[data-qn-note-id='${id}']`)
    act(() => rowOf('a').querySelector('button[data-qn-pin]').click())
    assert.deepEqual(spies.togglePin, ['a'])
    // Deleting a non-active note keeps the selection.
    act(() => rowOf('b').querySelector('button[data-qn-delete]').click())
    assert.deepEqual(spies.trashNote, ['b'])
    assert.deepEqual(spies.selectNote, [])
    // Deleting the active note selects the first remaining one.
    act(() => rowOf('a').querySelector('button[data-qn-delete]').click())
    assert.deepEqual(spies.trashNote, ['b', 'a'])
    assert.deepEqual(spies.selectNote, ['b'])
    // Footer navigation.
    act(() => view.container.querySelector('button[data-qn-settings]').click())
    act(() => view.container.querySelector('button[data-qn-trash]').click())
    assert.deepEqual(spies.setView, ['settings', 'trash'])
  } finally {
    view.unmount()
  }
})

test('trash panel restores, purges and empties through confirmation', () => {
  const spies = makeSpies()
  const trashed = [
    { ...makeNote('t1', 'T1'), deletedAt: 1_700_000_000_000 },
    { ...makeNote('t2', 'T2'), deletedAt: 1_700_000_000_000 },
  ]
  const view = mount(
    h(trash.TrashPanel, {
      t,
      state: makeState([], { trash: trashed }),
      actions: makeActions(spies),
    }),
  )
  try {
    const itemOf = (id) => view.container.querySelector(`li[data-qn-trash-id='${id}']`)
    assert.equal(view.container.querySelectorAll('li[data-qn-trash-id]').length, 2)
    act(() => itemOf('t1').querySelector('button').click())
    assert.deepEqual(spies.restoreNote, ['t1'])
    // Purge needs two clicks.
    act(() => itemOf('t2').querySelector('button[data-qn-purge]').click())
    assert.deepEqual(spies.purgeNote, [])
    act(() => itemOf('t2').querySelector('button[data-qn-purge]').click())
    assert.deepEqual(spies.purgeNote, ['t2'])
    // Emptying the bin needs two clicks as well.
    act(() => view.container.querySelector('button[data-qn-empty-trash]').click())
    assert.deepEqual(spies.emptyTrash, [])
    act(() => view.container.querySelector('button[data-qn-empty-trash]').click())
    assert.deepEqual(spies.emptyTrash, [true])
  } finally {
    view.unmount()
  }
})
