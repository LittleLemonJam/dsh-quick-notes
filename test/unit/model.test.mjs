/**
 * Unit tests for the pure state model.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS,
  SIDEBAR_LIMITS,
  buildPersistedState,
  clampSettings,
  clampUi,
  createInitialState,
  createNote,
  createNoteId,
  findNote,
  findTrashedNote,
  isValidPersistedState,
  migrateState,
  normalizeRect,
  normalizeTitle,
  sortNotes,
  upsertNote,
} from '../../src/shared/model.js'
import {
  MAX_NOTE_HTML_LENGTH,
  MAX_NOTES,
  MAX_TRASH,
  SCHEMA_VERSION,
} from '../../src/shared/constants.js'

test('normalizeTitle trims, collapses whitespace, strips control characters', () => {
  assert.equal(normalizeTitle('  hello   world  '), 'hello world')
  assert.equal(normalizeTitle('a\u0000b\u0007c'), 'a b c')
  assert.equal(normalizeTitle('', 'Untitled'), 'Untitled')
  assert.equal(normalizeTitle(null, 'Untitled'), 'Untitled')
  assert.equal(normalizeTitle('   ', ''), 'Untitled')
})

test('normalizeTitle caps the length', () => {
  assert.equal(normalizeTitle('x'.repeat(200)).length, 80)
})

test('createNoteId is deterministic for a fixed clock and random source', () => {
  assert.equal(
    createNoteId(1000, () => 0),
    'n_rs_0000',
  )
  assert.notEqual(
    createNoteId(1000, () => 0.5),
    createNoteId(1000, () => 0.6),
  )
})

test('createNote builds an empty unpinned note', () => {
  const note = createNote('  First idea ', 42, () => 0)
  assert.equal(note.title, 'First idea')
  assert.equal(note.html, '')
  assert.equal(note.pinned, false)
  assert.equal(note.createdAt, 42)
  assert.equal(note.updatedAt, 42)
  assert.match(note.id, /^n_/)
})

test('createInitialState centres the window and keeps defaults', () => {
  const state = createInitialState(10, { width: 1440, height: 900 })
  assert.equal(state.schemaVersion, SCHEMA_VERSION)
  assert.equal(state.notes.length, 0)
  assert.equal(state.activeId, null)
  assert.equal(state.ready, false)
  assert.equal(state.view, 'notes')
  assert.equal(state.sync.phase, 'loading')
  assert.equal(state.settings.fontSize, DEFAULT_SETTINGS.fontSize)
  assert.equal(state.ui.sidebarWidth, SIDEBAR_LIMITS.default)
  assert.ok(state.ui.rect.x > 0)
  assert.ok(state.ui.rect.y > 0)
  assert.ok(state.ui.ball.x > 0)
})

test('createInitialState tolerates a tiny viewport', () => {
  const state = createInitialState(10, { width: 100, height: 100 })
  assert.ok(state.ui.rect.x >= 24)
  assert.ok(state.ui.rect.y >= 64)
})

test('createInitialState places the window at the right-middle by default', () => {
  const state = createInitialState(10, { width: 1440, height: 900 })
  assert.equal(state.ui.rect.width, 560)
  assert.equal(state.ui.rect.height, 440)
  assert.equal(state.ui.rect.x, 1440 - 560 - 24)
  assert.equal(state.ui.rect.y, Math.round((900 - 440) / 2))
  assert.ok(state.ui.rect.y >= 64)
})

test('sortNotes keeps pinned notes first and preserves relative order', () => {
  const a = createNote('a', 1, () => 0.1)
  const b = createNote('b', 2, () => 0.2)
  const c = createNote('c', 3, () => 0.3)
  b.pinned = true
  const sorted = sortNotes([a, b, c])
  assert.deepEqual(
    sorted.map((note) => note.title),
    ['b', 'a', 'c'],
  )
  assert.equal(sorted[1], a)
  assert.equal(sorted[2], c)
})

test('upsertNote replaces in place and prepends new notes', () => {
  const a = createNote('a', 1, () => 0.1)
  const b = createNote('b', 2, () => 0.2)
  const replaced = { ...a, title: 'renamed' }
  const next = upsertNote([a, b], replaced)
  assert.equal(next.length, 2)
  assert.equal(next[0].title, 'renamed')
  assert.equal(next[1], b)
  const prepended = upsertNote(
    [a, b],
    createNote('c', 3, () => 0.3),
  )
  assert.equal(prepended.length, 3)
  assert.equal(prepended[0].title, 'c')
})

test('findNote and findTrashedNote look in the right buckets', () => {
  const note = createNote('a', 1, () => 0.1)
  const state = { notes: [note], trash: [{ ...note, id: 'n_trashed', deletedAt: 2 }] }
  assert.equal(findNote(state, note.id), note)
  assert.equal(findNote(state, 'missing'), undefined)
  assert.equal(findTrashedNote(state, 'n_trashed')?.id, 'n_trashed')
  assert.equal(findTrashedNote(state, note.id), undefined)
})

test('clampSettings rounds and clamps both fields', () => {
  const low = clampSettings({ fontSize: 1, lineHeight: 0.2 })
  assert.equal(low.fontSize, SETTINGS_LIMITS.fontSize.min)
  assert.equal(low.lineHeight, SETTINGS_LIMITS.lineHeight.min)
  const high = clampSettings({ fontSize: 99, lineHeight: 9 })
  assert.equal(high.fontSize, SETTINGS_LIMITS.fontSize.max)
  assert.equal(high.lineHeight, SETTINGS_LIMITS.lineHeight.max)
  const rounded = clampSettings({ fontSize: 15.6, lineHeight: 1.777 })
  assert.equal(rounded.fontSize, 16)
  assert.equal(rounded.lineHeight, 1.78)
  assert.deepEqual(clampSettings(null), DEFAULT_SETTINGS)
})

test('clampSettings normalises the ruled-lines and theme preferences', () => {
  const defaults = clampSettings({})
  assert.equal(defaults.ruledLines, false)
  assert.equal(defaults.theme, 'system')
  assert.equal(clampSettings({ ruledLines: true, theme: 'dark' }).ruledLines, true)
  assert.equal(clampSettings({ theme: 'dark' }).theme, 'dark')
  assert.equal(clampSettings({ theme: 'neon' }).theme, 'system')
  assert.equal(clampSettings({ ruledLines: 'yes' }).ruledLines, false)
  // An older persisted state without the new fields migrates to defaults.
  const migrated = migrateState(
    {
      schemaVersion: 1,
      notes: [],
      trash: [],
      activeId: null,
      settings: { fontSize: 16, lineHeight: 1.6 },
      ui: { mode: 'normal' },
    },
    1,
  )
  assert.equal(migrated.settings.ruledLines, false)
  assert.equal(migrated.settings.theme, 'system')
})

test('normalizeRect enforces minimums and numeric fields', () => {
  const rect = normalizeRect({ x: -20, y: 'nope', width: 10, height: 1 })
  assert.equal(rect.x, -20)
  assert.equal(rect.y, 96)
  assert.equal(rect.width, 320)
  assert.equal(rect.height, 240)
})

test('clampUi falls back for unknown modes and clamps sidebar width', () => {
  const ui = clampUi({
    mode: 'exploded',
    rect: { x: 10, y: 20, width: 500, height: 400 },
    compactRect: { x: 10, y: 20, width: 460, height: 400 },
    sidebarWidth: 999,
    ball: { x: -500, y: 99999 },
  })
  assert.equal(ui.mode, 'normal')
  assert.equal(ui.sidebarWidth, SIDEBAR_LIMITS.max)
  assert.equal(ui.compactRect.width, 460)
  assert.ok(Number.isFinite(ui.ball.x))
})

test('isValidPersistedState requires the structural fields', () => {
  assert.equal(isValidPersistedState(null), false)
  assert.equal(isValidPersistedState({}), false)
  assert.equal(isValidPersistedState({ notes: [], trash: [], activeId: null }), true)
  assert.equal(isValidPersistedState({ notes: [], trash: [] }), false)
})

test('migrateState normalises a legacy payload and drops invalid notes', () => {
  const migrated = migrateState(
    {
      schemaVersion: 1,
      savedAt: 5,
      notes: [
        { id: 'n_1', title: '  keep  ', html: '<p>hi</p>', pinned: 1, createdAt: 1, updatedAt: 2 },
        { id: 'n_1', title: 'duplicate' },
        { title: 'no id' },
        null,
      ],
      trash: [{ id: 'n_2', title: 'gone', deletedAt: 9 }],
      activeId: 'n_missing',
      settings: { fontSize: 16 },
      ui: { mode: 'compact' },
    },
    100,
  )
  assert.notEqual(migrated, null)
  assert.equal(migrated.notes.length, 1)
  assert.equal(migrated.notes[0].title, 'keep')
  assert.equal(migrated.notes[0].pinned, false)
  assert.equal(migrated.trash.length, 1)
  assert.equal(migrated.trash[0].deletedAt, 9)
  assert.equal(migrated.activeId, 'n_1')
  assert.equal(migrated.settings.fontSize, 16)
  assert.equal(migrated.ui.mode, 'compact')
  assert.equal(migrated.ready, false)
})

test('migrateState rejects unusable and future payloads', () => {
  assert.equal(migrateState(null), null)
  assert.equal(migrateState('nope'), null)
  assert.equal(migrateState({ schemaVersion: 99, notes: [], trash: [], activeId: null }), null)
})

test('migrateState caps the number of notes and trash entries', () => {
  const notes = Array.from({ length: MAX_NOTES + 5 }, (_, index) => ({
    id: `n_${index}`,
    title: `note ${index}`,
    html: '',
    pinned: false,
    createdAt: index,
    updatedAt: index,
  }))
  const trash = Array.from({ length: MAX_TRASH + 5 }, (_, index) => ({
    id: `t_${index}`,
    title: `trash ${index}`,
    html: '',
    pinned: false,
    createdAt: index,
    updatedAt: index,
    deletedAt: index,
  }))
  const migrated = migrateState({ notes, trash, activeId: null, schemaVersion: 1 }, 1)
  assert.equal(migrated.notes.length, MAX_NOTES)
  assert.equal(migrated.trash.length, MAX_TRASH)
})

test('buildPersistedState strips transient fields and normalises content', () => {
  const state = createInitialState(7, { width: 1000, height: 700 })
  state.ready = true
  state.view = 'trash'
  state.sync = { phase: 'synced', at: 8 }
  state.notes = [createNote('a', 9, () => 0.1)]
  state.notes[0].html = 'x'.repeat(300_000)
  const payload = buildPersistedState(state)
  assert.equal('ready' in payload, false)
  assert.equal('view' in payload, false)
  assert.equal('sync' in payload, false)
  assert.equal(payload.schemaVersion, SCHEMA_VERSION)
  assert.ok(payload.notes[0].html.length <= MAX_NOTE_HTML_LENGTH)
})
