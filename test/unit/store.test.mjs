/**
 * Unit tests for the notes store: lifecycle, actions, limits and persistence.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_NOTES, MAX_TRASH } from '../../src/shared/constants.js'
import {
  buildPersistedState,
  createInitialState,
  createNote,
  sortNotes,
} from '../../src/shared/model.js'
import { createNotesStore } from '../../src/client/store.js'

/**
 * Build a persisted payload with optional notes.
 * @param options - notes and savedAt.
 * @returns the payload.
 */
function persisted({ notes = [], savedAt = 100 } = {}) {
  const state = createInitialState(1, { width: 1000, height: 700 })
  state.notes = notes
  state.activeId = notes[0]?.id ?? null
  state.savedAt = savedAt
  return buildPersistedState(state)
}

/**
 * Build an in-memory storage adapter.
 * @param options - initial local/remote copies and failures.
 * @returns the adapter plus inspection fields.
 */
function fakeStorage({ local = null, remote = null, loadError = null, saveError = null } = {}) {
  const adapter = {
    local,
    remote,
    loadError,
    saveError,
    writes: [],
    readLocalState() {
      return adapter.local
    },
    writeLocalState(state) {
      adapter.local = state
    },
    async loadRemoteState() {
      if (adapter.loadError !== null) throw adapter.loadError
      return adapter.remote
    },
    async saveRemoteState(state, keepalive = false) {
      if (adapter.saveError !== null) throw adapter.saveError
      adapter.writes.push({ savedAt: state.savedAt, keepalive })
      adapter.remote = state
      return { savedAt: state.savedAt }
    },
  }
  return adapter
}

/**
 * Create a store with a deterministic clock.
 * @param storage - fake adapter.
 * @returns `{ store, tick }`.
 */
function createStore(storage) {
  let time = 1000
  const tick = () => (time += 10)
  return { store: createNotesStore({ storage, now: tick }), tick }
}

/**
 * Run a callback with a fake browser viewport installed.
 * @param viewport - `{ width, height }` of the fake window.
 * @param callback - code to run while the viewport is installed.
 * @returns whatever the callback returns.
 */
async function withViewport(viewport, callback) {
  const saved = globalThis.window
  globalThis.window = { innerWidth: viewport.width, innerHeight: viewport.height }
  try {
    return await callback()
  } finally {
    if (saved === undefined) delete globalThis.window
    else globalThis.window = saved
  }
}

test('start settles an empty profile and writes the initial state', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  const state = store.getState()
  assert.equal(state.ready, true)
  assert.equal(state.sync.phase, 'synced')
  assert.equal(storage.remote.notes.length, 0)
  store.dispose()
})

test('start adopts a newer Host copy', async () => {
  const remoteNote = createNote('remote idea', 5, () => 0.2)
  const storage = fakeStorage({ remote: persisted({ notes: [remoteNote], savedAt: 5000 }) })
  const { store } = createStore(storage)
  await store.start()
  const state = store.getState()
  assert.equal(state.ready, true)
  assert.equal(state.notes[0].title, 'remote idea')
  assert.equal(state.sync.phase, 'synced')
  assert.equal(storage.local.savedAt, 5000)
  store.dispose()
})

test('start keeps a newer local mirror and pushes it to the Host', async () => {
  const localNote = createNote('local idea', 6, () => 0.3)
  const remoteNote = createNote('stale idea', 5, () => 0.2)
  const storage = fakeStorage({
    local: { ...persisted({ notes: [localNote], savedAt: 6000 }), ready: false, view: 'notes' },
    remote: persisted({ notes: [remoteNote], savedAt: 5000 }),
  })
  const { store } = createStore(storage)
  await store.start()
  const state = store.getState()
  assert.equal(state.notes[0].title, 'local idea')
  assert.equal(storage.remote.notes[0].title, 'local idea')
  store.dispose()
})

test('start falls back to the local mirror when the Host is unreachable', async () => {
  const localNote = createNote('offline idea', 7, () => 0.4)
  const storage = fakeStorage({
    local: { ...persisted({ notes: [localNote], savedAt: 7000 }), ready: false, view: 'notes' },
    loadError: new Error('offline'),
  })
  const { store } = createStore(storage)
  await store.start()
  const state = store.getState()
  assert.equal(state.ready, true)
  assert.equal(state.sync.phase, 'local')
  assert.equal(state.notes[0].title, 'offline idea')
  store.dispose()
})

test('createNote selects the new note and persists after flush', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  const id = store.actions.createNote('first idea')
  assert.equal(typeof id, 'string')
  const state = store.getState()
  assert.equal(state.notes.length, 1)
  assert.equal(state.activeId, id)
  assert.equal(storage.remote.notes.length, 0)
  await store.actions.flush()
  assert.equal(storage.remote.notes.length, 1)
  assert.equal(storage.remote.notes[0].title, 'first idea')
  store.dispose()
})

test('renameNote, setNoteHtml and togglePin update the note', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  const id = store.actions.createNote('draft')
  store.actions.renameNote(id, '  renamed  ')
  store.actions.setNoteHtml(id, '<p>body</p>')
  store.actions.togglePin(id)
  const note = store.getState().notes[0]
  assert.equal(note.title, 'renamed')
  assert.equal(note.html, '<p>body</p>')
  assert.equal(note.pinned, true)
  await store.actions.flush()
  assert.equal(storage.remote.notes[0].pinned, true)
  store.dispose()
})

test('setNoteHtml stores the editor HTML verbatim', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  const id = store.actions.createNote('draft')
  store.actions.setNoteHtml(id, '<p>hello <b>world</b></p>')
  const note = store.getState().notes[0]
  assert.equal(note.html, '<p>hello <b>world</b></p>')
  store.dispose()
})

test('renameNote ignores unknown notes and keeps the previous title for empty input', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  const id = store.actions.createNote('keep me')
  store.actions.renameNote(id, '   ')
  store.actions.renameNote('missing', 'x')
  assert.equal(store.getState().notes[0].title, 'keep me')
  store.dispose()
})

test('trash, restore, purge and emptyTrash move notes correctly', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  const first = store.actions.createNote('first')
  const second = store.actions.createNote('second')

  store.actions.trashNote(first)
  let state = store.getState()
  assert.equal(state.notes.length, 1)
  assert.equal(state.trash.length, 1)
  assert.equal(state.activeId, second)

  store.actions.restoreNote(first)
  state = store.getState()
  assert.equal(state.notes.length, 2)
  assert.equal(state.trash.length, 0)
  assert.equal(state.activeId, first)
  assert.equal(state.view, 'notes')

  store.actions.trashNote(second)
  store.actions.purgeNote(second)
  state = store.getState()
  assert.equal(state.trash.length, 0)
  assert.equal(state.notes.length, 1)

  store.actions.trashNote(first)
  store.actions.emptyTrash()
  state = store.getState()
  assert.equal(state.trash.length, 0)
  store.dispose()
})

test('selectNote, setView and setMode validate their inputs', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  const id = store.actions.createNote('one')
  store.actions.selectNote('missing')
  assert.equal(store.getState().activeId, null)
  store.actions.selectNote(id)
  assert.equal(store.getState().activeId, id)
  store.actions.setView('trash')
  assert.equal(store.getState().view, 'trash')
  store.actions.setView('nope')
  assert.equal(store.getState().view, 'trash')
  store.actions.setMode('ball')
  assert.equal(store.getState().ui.mode, 'ball')
  store.actions.setMode('exploded')
  assert.equal(store.getState().ui.mode, 'ball')
  store.dispose()
})

test('updateSettings and updateUi clamp their patches', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  store.actions.updateSettings({ fontSize: 99, lineHeight: 0.1 })
  let state = store.getState()
  assert.equal(state.settings.fontSize, 20)
  assert.equal(state.settings.lineHeight, 1.4)
  store.actions.updateUi({ sidebarWidth: 999, rect: { x: 1, y: 2, width: 100, height: 100 } })
  state = store.getState()
  assert.equal(state.ui.sidebarWidth, 320)
  assert.equal(state.ui.rect.width, 320)
  assert.equal(state.ui.rect.height, 240)
  store.dispose()
})

test('importState accepts an exported payload and rejects garbage', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  const note = createNote('imported', 11, () => 0.7)
  const payload = persisted({ notes: [note], savedAt: 9000 })
  assert.deepEqual(store.actions.importState({ state: payload }), { ok: true })
  assert.equal(store.getState().notes[0].title, 'imported')
  assert.deepEqual(store.actions.importState({ nope: true }), { ok: false, message: 'invalid' })
  store.dispose()
})

test('exportState returns a persisted payload without transient fields', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  store.actions.createNote('export me')
  const payload = store.actions.exportState()
  assert.equal('ready' in payload, false)
  assert.equal('view' in payload, false)
  assert.equal('sync' in payload, false)
  assert.equal(payload.notes[0].title, 'export me')
  store.dispose()
})

test('the directory stops at MAX_NOTES', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  for (let index = 0; index < MAX_NOTES; index += 1) store.actions.createNote(`note ${index}`)
  assert.equal(store.getState().notes.length, MAX_NOTES)
  assert.equal(store.actions.createNote('one too many'), null)
  store.dispose()
})

test('the recycle bin stops at MAX_TRASH', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  for (let index = 0; index < MAX_TRASH + 3; index += 1) {
    const id = store.actions.createNote(`note ${index}`)
    store.actions.trashNote(id)
  }
  assert.equal(store.getState().trash.length, MAX_TRASH)
  store.dispose()
})

test('a failing Host write reports the error phase', async () => {
  const storage = fakeStorage({ saveError: new Error('down') })
  const { store } = createStore(storage)
  await store.start()
  assert.equal(store.getState().sync.phase, 'error')
  store.dispose()
})

test('dispose stops pending persistence', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  store.actions.createNote('never saved')
  store.dispose()
  await store.actions.flush()
  assert.equal(storage.remote.notes.length, 0)
})

test('adopting a newer Host copy bumps contentEpoch so the editor reloads', async () => {
  const remoteNote = createNote('remote idea', 5, () => 0.2)
  const storage = fakeStorage({ remote: persisted({ notes: [remoteNote], savedAt: 5000 }) })
  const { store } = createStore(storage)
  await store.start()
  assert.equal(store.getState().contentEpoch, 1)
  store.dispose()
})

test('importState sanitises HTML and bumps contentEpoch', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  const note = createNote('imported', 11, () => 0.7)
  note.html = '<p>ok</p><script>alert(1)</script><img src=x onerror=alert(1)>'
  const payload = persisted({ notes: [note], savedAt: 9000 })
  assert.deepEqual(store.actions.importState({ state: payload }), { ok: true })
  const state = store.getState()
  assert.equal(state.contentEpoch, 1)
  assert.equal(state.notes[0].html.includes('<script'), false)
  assert.equal(state.notes[0].html.includes('onerror'), false)
  assert.match(state.notes[0].html, /ok/)
  store.dispose()
})

test('exportState returns sanitised HTML, matching the write path', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  const id = store.actions.createNote('export me')
  store.actions.setNoteHtml(id, '<p>safe</p><script>alert(1)</script>')
  const payload = store.actions.exportState()
  assert.equal(payload.notes[0].html.includes('<script'), false)
  assert.match(payload.notes[0].html, /safe/)
  store.dispose()
})

test('moveNote reorders inside the unpinned group and clamps at its edges', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  const a = store.actions.createNote('a')
  store.actions.createNote('b')
  const c = store.actions.createNote('c')
  // Current display order is [c, b, a]; move c to the end of the group.
  store.actions.moveNote(c, 2)
  assert.deepEqual(
    sortNotes(store.getState().notes).map((note) => note.title),
    ['b', 'a', 'c'],
  )
  // Clamping: a target past the group edge lands on the last slot.
  store.actions.moveNote(a, 99)
  assert.deepEqual(
    sortNotes(store.getState().notes).map((note) => note.title),
    ['b', 'c', 'a'],
  )
  store.dispose()
})

test('moveNote cannot cross the pinned / unpinned boundary', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  const pinned = store.actions.createNote('pinned')
  store.actions.togglePin(pinned)
  const plainA = store.actions.createNote('plain-a')
  store.actions.createNote('plain-b')
  // Display order is [pinned, plain-b, plain-a].
  store.actions.moveNote(pinned, 2)
  assert.deepEqual(
    sortNotes(store.getState().notes).map((note) => note.title),
    ['pinned', 'plain-b', 'plain-a'],
  )
  // A cross-boundary target (index 0) is clamped to the unpinned group start.
  store.actions.moveNote(plainA, 0)
  assert.deepEqual(
    sortNotes(store.getState().notes).map((note) => note.title),
    ['pinned', 'plain-a', 'plain-b'],
  )
  assert.equal(store.getState().notes.length, 3)
  store.dispose()
})

test('updateSettings persists the theme and ruled-lines preferences', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  store.actions.updateSettings({ theme: 'dark', ruledLines: true })
  assert.equal(store.getState().settings.theme, 'dark')
  assert.equal(store.getState().settings.ruledLines, true)
  await store.actions.flush()
  assert.equal(storage.remote.settings.theme, 'dark')
  assert.equal(storage.remote.settings.ruledLines, true)
  store.actions.updateSettings({ theme: 'not-a-theme' })
  assert.equal(store.getState().settings.theme, 'dark')
  store.dispose()
})

test('resetWindowSize restores the default size and leaves compact mode', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  store.actions.updateUi({
    rect: { x: 40, y: 80, width: 900, height: 700 },
    compactRect: { x: 40, y: 80, width: 900, height: 700 },
  })
  store.actions.setMode('compact')
  store.actions.resetWindowSize()
  const state = store.getState()
  assert.equal(state.ui.mode, 'normal')
  assert.equal(state.ui.compactRect, null)
  assert.equal(state.ui.rect.width, 560)
  assert.equal(state.ui.rect.height, 440)
  assert.equal(state.ui.rect.x, 40)
  assert.equal(state.ui.rect.y, 80)
  store.dispose()
})

test('resetWindowPosition moves the window to the right-middle safe area', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  store.actions.updateUi({ rect: { x: 5, y: 5, width: 500, height: 400 } })
  store.actions.resetWindowPosition()
  const rect = store.getState().ui.rect
  // Node has no window; the action falls back to a 1280x800 viewport.
  assert.equal(rect.x, 1280 - 500 - 24)
  assert.equal(rect.y, Math.max(64, Math.round((800 - 400) / 2)))
  assert.equal(rect.width, 500)
  assert.equal(rect.height, 400)
  store.dispose()
})

test('resetWindowSize clamps the restored size into a small viewport', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  await withViewport({ width: 800, height: 500 }, () => {
    store.actions.updateUi({ rect: { x: 700, y: 450, width: 560, height: 440 } })
    store.actions.resetWindowSize()
  })
  const rect = store.getState().ui.rect
  assert.equal(rect.width, 560)
  assert.equal(rect.height, 440)
  assert.ok(rect.x + rect.width <= 800, `right edge ${rect.x + rect.width}`)
  assert.ok(rect.y + rect.height <= 500, `bottom edge ${rect.y + rect.height}`)
  assert.ok(rect.y >= Math.min(64, 500 - 440), `top edge ${rect.y}`)
  store.dispose()
})

test('resetWindowPosition clamps the right-middle position into a small viewport', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  await withViewport({ width: 800, height: 500 }, () => {
    store.actions.updateUi({ rect: { x: 5, y: 5, width: 560, height: 440 } })
    store.actions.resetWindowPosition()
  })
  const rect = store.getState().ui.rect
  assert.equal(rect.width, 560)
  assert.equal(rect.height, 440)
  assert.equal(rect.x, 800 - 560 - 24)
  assert.ok(rect.x + rect.width <= 800, `right edge ${rect.x + rect.width}`)
  assert.ok(rect.y + rect.height <= 500, `bottom edge ${rect.y + rect.height}`)
  store.dispose()
})

test('pinned notes stay first while the directory order is otherwise stable', async () => {
  const storage = fakeStorage()
  const { store } = createStore(storage)
  await store.start()
  store.actions.createNote('a')
  store.actions.createNote('b')
  store.actions.createNote('c')
  const ids = store.getState().notes.map((note) => note.id)
  store.actions.togglePin(ids[2])
  const titles = sortNotes(store.getState().notes).map((note) => note.title)
  assert.deepEqual(titles, ['a', 'c', 'b'])
  store.dispose()
})
