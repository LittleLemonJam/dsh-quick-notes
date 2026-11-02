/**
 * Unit tests for the Host HTTP handlers.
 */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { MAX_REQUEST_BYTES, SCHEMA_VERSION } from '../../src/shared/constants.js'
import { createHandlers } from '../../src/host/routes.js'
import { fakeRequest, fakeResponse, jsonBody, temporaryDirectory } from './_helpers.mjs'

/** A fence that accepts everything, for handler-focused tests. */
const allowAll = () => ({ ok: true })

/** A fence that rejects everything. */
const denyAll = () => ({ ok: false, status: 403, reason: 'test' })

/**
 * Build a valid persisted state.
 * @returns the state.
 */
function state() {
  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: 10,
    notes: [],
    trash: [],
    activeId: null,
    settings: { fontSize: 15, lineHeight: 1.75 },
    ui: { mode: 'normal' },
  }
}

/**
 * Call one handler with a fake request/response pair.
 * @param handler - route handler.
 * @param options - request options.
 * @returns the response recorder.
 */
async function call(handler, options) {
  const response = fakeResponse()
  await handler(fakeRequest(options), response)
  return response
}

test('GET /state reports null before the first write', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const handlers = createHandlers({ directory, version: '1.2.3', fence: allowAll })
    const response = await call(handlers.state, { method: 'GET', headers: { host: '127.0.0.1:1' } })
    assert.equal(response.status, 200)
    assert.deepEqual(jsonBody(response), { ok: true, state: null, corrupt: false })
  } finally {
    await cleanup()
  }
})

test('PUT /state persists a payload and GET reads it back', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const handlers = createHandlers({ directory, version: '1.2.3', fence: allowAll })
    const put = await call(handlers.state, {
      method: 'PUT',
      headers: { host: '127.0.0.1:1', 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, state: state() }),
    })
    assert.equal(put.status, 200)
    assert.equal(jsonBody(put).ok, true)
    const get = await call(handlers.state, { method: 'GET', headers: { host: '127.0.0.1:1' } })
    assert.deepEqual(jsonBody(get).state, state())
  } finally {
    await cleanup()
  }
})

test('PUT /state rejects wrong methods, content types, bodies and envelopes', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const handlers = createHandlers({ directory, version: '1.2.3', fence: allowAll })
    const wrongMethod = await call(handlers.state, {
      method: 'POST',
      headers: { host: '127.0.0.1:1' },
    })
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.headers.allow, 'GET, PUT')

    const wrongType = await call(handlers.state, {
      method: 'PUT',
      headers: { host: '127.0.0.1:1', 'content-type': 'text/plain' },
      body: 'hello',
    })
    assert.equal(wrongType.status, 415)

    const badJson = await call(handlers.state, {
      method: 'PUT',
      headers: { host: '127.0.0.1:1', 'content-type': 'application/json' },
      body: '{nope',
    })
    assert.equal(badJson.status, 400)

    const badEnvelope = await call(handlers.state, {
      method: 'PUT',
      headers: { host: '127.0.0.1:1', 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, state: { schemaVersion: 99 } }),
    })
    assert.equal(badEnvelope.status, 400)

    const tooLarge = await call(handlers.state, {
      method: 'PUT',
      headers: { host: '127.0.0.1:1', 'content-type': 'application/json' },
      body: 'x'.repeat(MAX_REQUEST_BYTES + 1),
    })
    assert.equal(tooLarge.status, 413)
  } finally {
    await cleanup()
  }
})

test('the fence is applied before every handler', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const handlers = createHandlers({ directory, version: '1.2.3', fence: denyAll })
    assert.equal((await call(handlers.state, { method: 'GET' })).status, 403)
    assert.equal((await call(handlers.health, { method: 'GET' })).status, 403)
  } finally {
    await cleanup()
  }
})

test('GET /health reports the version and storage kind', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const handlers = createHandlers({ directory, version: '9.9.9', fence: allowAll })
    const response = await call(handlers.health, {
      method: 'GET',
      headers: { host: '127.0.0.1:1' },
    })
    assert.equal(response.status, 200)
    const body = jsonBody(response)
    assert.equal(body.ok, true)
    assert.equal(body.version, '9.9.9')
    assert.equal(body.storage, 'file')
    const wrongMethod = await call(handlers.health, { method: 'PUT' })
    assert.equal(wrongMethod.status, 405)
  } finally {
    await cleanup()
  }
})

test('POST /diagnostic appends a Client diagnostic entry', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const handlers = createHandlers({ directory, version: '1.2.3', fence: allowAll })
    const response = await call(handlers.diagnostic, {
      method: 'POST',
      headers: { host: '127.0.0.1:1', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'mounted', version: '1.2.3', mode: 'normal' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(jsonBody(response), { ok: true })
    const lines = (await readFile(join(directory, 'diagnostics.log'), 'utf8')).trim().split('\n')
    assert.equal(JSON.parse(lines[0]).kind, 'mounted')
  } finally {
    await cleanup()
  }
})

test('POST /diagnostic reports a write failure as 500, not a healthy 200', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    // A file where the data directory should be makes mkdir/appendFile fail.
    const blocked = join(directory, 'not-a-directory')
    await writeFile(blocked, 'x')
    const handlers = createHandlers({ directory: blocked, version: '1.2.3', fence: allowAll })
    const response = await call(handlers.diagnostic, {
      method: 'POST',
      headers: { host: '127.0.0.1:1', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'mounted' }),
    })
    assert.equal(response.status, 500)
  } finally {
    await cleanup()
  }
})

test('POST /diagnostic validates method, content type, body and kind', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const handlers = createHandlers({ directory, version: '1.2.3', fence: allowAll })
    const headers = { host: '127.0.0.1:1', 'content-type': 'application/json' }
    assert.equal((await call(handlers.diagnostic, { method: 'GET', headers })).status, 405)
    assert.equal(
      (
        await call(handlers.diagnostic, {
          method: 'POST',
          headers: { host: '127.0.0.1:1', 'content-type': 'text/plain' },
          body: 'x',
        })
      ).status,
      415,
    )
    assert.equal(
      (await call(handlers.diagnostic, { method: 'POST', headers, body: '{nope' })).status,
      400,
    )
    assert.equal(
      (
        await call(handlers.diagnostic, {
          method: 'POST',
          headers,
          body: JSON.stringify({ kind: 'unknown-kind' }),
        })
      ).status,
      400,
    )
  } finally {
    await cleanup()
  }
})
