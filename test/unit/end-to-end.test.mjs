/**
 * End-to-end persistence test: Client storage adapter -> Host route handlers
 * -> state file, and a second page reading the file back.
 *
 * The two halves are wired together with an in-process fetch shim so this runs
 * in Node without a browser or a listening server.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { createStorage } from '../../src/client/storage.js'
import { createNotesStore } from '../../src/client/store.js'
import { createHandlers } from '../../src/host/routes.js'
import { fakeLocalStorage, fakeRequest, fakeResponse, temporaryDirectory } from './_helpers.mjs'

/** A fence that accepts every request, for the in-process wiring. */
const allowAll = () => ({ ok: true })

/**
 * Route one fake fetch call through the real Host handlers.
 * @param handlers - route handlers under test.
 * @returns a fetch-compatible function.
 */
function hostFetch(handlers) {
  return async (url, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase()
    const request = fakeRequest({
      method,
      headers: { host: '127.0.0.1:58587', ...(init.headers ?? {}) },
      body: typeof init.body === 'string' ? init.body : '',
    })
    const response = fakeResponse()
    await handlers.state(request, response)
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      async json() {
        return JSON.parse(response.body)
      },
    }
  }
}

test('a note written by one page is stored on disk and read by the next page', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const handlers = createHandlers({ directory, version: '0.1.0', fence: allowAll })
    const fetchImpl = hostFetch(handlers)
    const clock = { value: 1000 }
    const now = () => (clock.value += 10)

    const pageOne = createNotesStore({
      storage: createStorage({ fetchImpl, storage: fakeLocalStorage() }),
      now,
    })
    await pageOne.start()
    const id = pageOne.actions.createNote('written by page one')
    pageOne.actions.setNoteHtml(id, '<p>hello <mark>world</mark></p>')
    await pageOne.actions.flush()
    pageOne.dispose()

    const onDisk = JSON.parse(await readFile(join(directory, 'notes.json'), 'utf8'))
    assert.equal(onDisk.ok, true)
    assert.equal(onDisk.state.notes.length, 1)
    assert.equal(onDisk.state.notes[0].title, 'written by page one')
    assert.match(onDisk.state.notes[0].html, /hello/)
    assert.match(onDisk.state.notes[0].html, /<mark>world<\/mark>/)

    // A second page starts with an empty localStorage mirror and must adopt the
    // Host copy, not overwrite it with its initial state.
    const pageTwo = createNotesStore({
      storage: createStorage({ fetchImpl, storage: fakeLocalStorage() }),
      now,
    })
    await pageTwo.start()
    const state = pageTwo.getState()
    assert.equal(state.ready, true)
    assert.equal(state.notes.length, 1)
    assert.equal(state.notes[0].title, 'written by page one')
    assert.equal(state.sync.phase, 'synced')
    pageTwo.dispose()
  } finally {
    await cleanup()
  }
})

test('a corrupt state file is reported and replaced by the local mirror', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(directory, 'notes.json'), '{not json', 'utf8')

    const handlers = createHandlers({ directory, version: '0.1.0', fence: allowAll })
    const fetchImpl = hostFetch(handlers)
    const clock = { value: 5000 }
    const now = () => (clock.value += 10)

    const store = createNotesStore({
      storage: createStorage({ fetchImpl, storage: fakeLocalStorage() }),
      now,
    })
    await store.start()
    store.actions.createNote('recovered')
    await store.actions.flush()

    const onDisk = JSON.parse(await readFile(join(directory, 'notes.json'), 'utf8'))
    assert.equal(onDisk.state.notes[0].title, 'recovered')
    store.dispose()
  } finally {
    await cleanup()
  }
})
