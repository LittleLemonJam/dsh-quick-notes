/**
 * Unit tests for the Client persistence adapter.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STATE_PATH } from '../../src/shared/constants.js'
import { buildPersistedState, createInitialState, createNote } from '../../src/shared/model.js'
import {
  LOCAL_STORAGE_KEY,
  createStorage,
  loadRemote,
  readLocal,
  saveRemote,
  serializeForPersist,
  writeLocal,
} from '../../src/client/storage.js'
import { fakeLocalStorage } from './_helpers.mjs'

/**
 * Build a runtime state with one note.
 * @param html - note HTML.
 * @returns the state.
 */
function stateWithNote(html = '<p>hello</p>') {
  const state = createInitialState(1, { width: 1000, height: 700 })
  const note = createNote('idea', 2, () => 0.5)
  note.html = html
  state.notes = [note]
  state.activeId = note.id
  return state
}

/**
 * Build a fetch stub that records calls.
 * @param responder - receives (url, init) and returns a response-like object.
 * @returns the fetch stub with a `calls` array.
 */
function fakeFetch(responder) {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url, init })
    return responder(url, init)
  }
  impl.calls = calls
  return impl
}

/**
 * Build a Response-like object.
 * @param body - JSON body.
 * @param options - status override.
 * @returns the response-like object.
 */
function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body
    },
  }
}

test('local mirror round-trips through localStorage', () => {
  const storage = fakeLocalStorage()
  const payload = buildPersistedState(stateWithNote())
  assert.equal(writeLocal(storage, payload), true)
  assert.ok(storage.map.has(LOCAL_STORAGE_KEY))
  assert.deepEqual(readLocal(storage), JSON.parse(JSON.stringify(payload)))
})

test('local mirror tolerates missing storage and corrupted values', () => {
  assert.equal(readLocal(null), null)
  assert.equal(writeLocal(null, {}), false)
  const storage = fakeLocalStorage({ [LOCAL_STORAGE_KEY]: '{broken' })
  assert.equal(readLocal(storage), null)
})

test('serializeForPersist strips transient fields and sanitises HTML', () => {
  const state = stateWithNote('<p>ok</p><script>alert(1)</script>')
  state.ready = true
  state.view = 'trash'
  state.sync = { phase: 'synced', at: 3 }
  const payload = serializeForPersist(state)
  assert.equal('ready' in payload, false)
  assert.equal('view' in payload, false)
  assert.equal('sync' in payload, false)
  assert.equal(payload.notes.length, 1)
  assert.equal(payload.notes[0].html.includes('<script'), false)
})

test('loadRemote GETs the state route', async () => {
  const payload = buildPersistedState(stateWithNote())
  const fetchImpl = fakeFetch(() => jsonResponse({ ok: true, state: payload }))
  const result = await loadRemote(fetchImpl, STATE_PATH, 500)
  assert.deepEqual(result, payload)
  assert.equal(fetchImpl.calls[0].url, STATE_PATH)
  assert.equal(fetchImpl.calls[0].init.method, 'GET')
})

test('loadRemote reports HTTP and payload failures', async () => {
  await assert.rejects(() =>
    loadRemote(fakeFetch(() => jsonResponse({}, { ok: false, status: 500 }))),
  )
  await assert.rejects(() => loadRemote(fakeFetch(() => jsonResponse({ ok: false }))))
})

test('saveRemote PUTs the state and returns savedAt', async () => {
  const payload = buildPersistedState(stateWithNote())
  const fetchImpl = fakeFetch(() => jsonResponse({ ok: true, savedAt: 4242 }))
  const result = await saveRemote(fetchImpl, payload, STATE_PATH, 500, true)
  assert.deepEqual(result, { savedAt: 4242 })
  const call = fetchImpl.calls[0]
  assert.equal(call.init.method, 'PUT')
  assert.equal(call.init.keepalive, true)
  assert.equal(call.init.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(call.init.body), { ok: true, state: payload })
})

test('saveRemote reports HTTP failures', async () => {
  await assert.rejects(() =>
    saveRemote(
      fakeFetch(() => jsonResponse({}, { ok: false, status: 500 })),
      {},
    ),
  )
})

test('createStorage wires the local mirror and the Host route together', async () => {
  const storage = fakeLocalStorage()
  const remotePayload = buildPersistedState(stateWithNote('<p>remote</p>'))
  const fetchImpl = fakeFetch((url, init) =>
    init.method === 'GET'
      ? jsonResponse({ ok: true, state: remotePayload })
      : jsonResponse({ ok: true, savedAt: 99 }),
  )
  const adapter = createStorage({ fetchImpl, storage, timeoutMs: 500 })

  const localState = stateWithNote('<p>local</p>')
  adapter.writeLocalState(localState)
  const readBack = adapter.readLocalState()
  assert.equal(readBack.notes.length, 1)
  assert.equal(readBack.notes[0].title, localState.notes[0].title)

  const remote = await adapter.loadRemoteState()
  assert.equal(remote.notes[0].title, 'idea')

  const result = await adapter.saveRemoteState(localState)
  assert.deepEqual(result, { savedAt: 99 })
  assert.equal(fetchImpl.calls.filter((call) => call.init.method === 'PUT').length, 1)
})
