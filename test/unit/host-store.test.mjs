/**
 * Unit tests for the Host state file: validation, atomic round-trip, recovery.
 */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { MAX_REQUEST_BYTES, SCHEMA_VERSION } from '../../src/shared/constants.js'
import { createStateStore, validateStatePayload } from '../../src/host/store.js'
import { temporaryDirectory } from './_helpers.mjs'

/**
 * Build a minimal valid persisted payload.
 * @param overrides - fields merged over the defaults.
 * @returns the payload.
 */
function payload(overrides = {}) {
  return {
    ok: true,
    state: {
      schemaVersion: SCHEMA_VERSION,
      savedAt: 123,
      notes: [],
      trash: [],
      activeId: null,
      settings: { fontSize: 15, lineHeight: 1.75 },
      ui: { mode: 'normal' },
      ...overrides,
    },
  }
}

test('validateStatePayload accepts a well-formed envelope', () => {
  assert.deepEqual(validateStatePayload(payload()), { ok: true, state: payload().state })
})

test('validateStatePayload rejects malformed envelopes', () => {
  assert.equal(validateStatePayload(null).ok, false)
  assert.equal(validateStatePayload({}).ok, false)
  assert.equal(validateStatePayload({ state: null }).ok, false)
  assert.equal(validateStatePayload(payload({ schemaVersion: 2 })).ok, false)
  assert.equal(validateStatePayload(payload({ notes: {} })).ok, false)
  assert.equal(validateStatePayload(payload({ trash: null })).ok, false)
  assert.equal(validateStatePayload(payload({ activeId: 4 })).ok, false)
  assert.equal(validateStatePayload(payload({ settings: null })).ok, false)
  assert.equal(validateStatePayload(payload({ ui: null })).ok, false)
})

test('validateStatePayload enforces the size cap', () => {
  const big = 'x'.repeat(MAX_REQUEST_BYTES + 10)
  const result = validateStatePayload(payload({ notes: [{ id: 'n_1', html: big }] }))
  assert.equal(result.ok, false)
  assert.match(result.reason, /size/)
})

test('write then read round-trips the state file', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const store = createStateStore({ directory })
    const result = await store.write(payload({ savedAt: 777 }).state)
    assert.equal(result.savedAt, 777)
    const read = await store.read()
    assert.equal(read.corrupt, false)
    assert.equal(read.state.savedAt, 777)
    const text = await readFile(join(directory, 'notes.json'), 'utf8')
    assert.match(text, /"savedAt":777/)
  } finally {
    await cleanup()
  }
})

test('read reports a missing file without an error', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const store = createStateStore({ directory })
    assert.deepEqual(await store.read(), { state: null, corrupt: false })
  } finally {
    await cleanup()
  }
})

test('read recovers from a corrupted file by reporting it', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    await writeFile(join(directory, 'notes.json'), '{not json', 'utf8')
    const store = createStateStore({ directory })
    assert.deepEqual(await store.read(), { state: null, corrupt: true })
  } finally {
    await cleanup()
  }
})

test('read rejects a file that is not a valid state envelope', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    await writeFile(join(directory, 'notes.json'), JSON.stringify({ hello: 'world' }), 'utf8')
    const store = createStateStore({ directory })
    assert.deepEqual(await store.read(), { state: null, corrupt: true })
  } finally {
    await cleanup()
  }
})

test('concurrent writes are serialised and the last one wins', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const store = createStateStore({ directory })
    await Promise.all([
      store.write(payload({ savedAt: 1 }).state),
      store.write(payload({ savedAt: 2 }).state),
      store.write(payload({ savedAt: 3 }).state),
    ])
    const read = await store.read()
    assert.equal(read.state.savedAt, 3)
  } finally {
    await cleanup()
  }
})

test('write refuses an oversized state', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const store = createStateStore({ directory })
    const big = 'x'.repeat(MAX_REQUEST_BYTES + 10)
    await assert.rejects(() =>
      store.write({
        ...payload().state,
        notes: [{ id: 'n_1', html: big }],
      }),
    )
  } finally {
    await cleanup()
  }
})
