/**
 * Host entry wiring test: `index.js` must register the three routes with the
 * Web server and the handlers must answer through the same fence the plugin
 * uses in production.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, inject } from '../../index.js'
import { DIAGNOSTIC_PATH, HEALTH_PATH, STATE_PATH } from '../../src/shared/constants.js'
import { fakeRequest, fakeResponse, jsonBody, temporaryDirectory } from './_helpers.mjs'

/**
 * Build a minimal Host plugin context that records effects and routes.
 * @param routes - collected route registrations.
 * @param cleanups - collected effect disposers.
 * @returns the fake context.
 */
function fakeContext(routes, cleanups) {
  return {
    logger: { info() {}, warn() {}, debug() {} },
    effect(callback, label) {
      void label
      const dispose = callback()
      cleanups.push(dispose)
      return dispose
    },
    webServer: {
      getOrigin: () => 'http://127.0.0.1:58587',
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
  }
}

test('index.js injects webServer and registers every route', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  const previous = process.env.DSH_QUICK_NOTES_DIR
  process.env.DSH_QUICK_NOTES_DIR = directory
  const routes = []
  const cleanups = []
  try {
    assert.deepEqual(inject, ['webServer'])
    apply(fakeContext(routes, cleanups))
    const paths = routes.map((route) => route.path)
    assert.deepEqual(paths, [STATE_PATH, HEALTH_PATH, DIAGNOSTIC_PATH])
    for (const route of routes) assert.equal(route.kind, 'exact')
    assert.equal(cleanups.length, 3)
  } finally {
    if (previous === undefined) delete process.env.DSH_QUICK_NOTES_DIR
    else process.env.DSH_QUICK_NOTES_DIR = previous
    await cleanup()
  }
})

test('the registered handlers answer a health check and persist a state payload', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  const previous = process.env.DSH_QUICK_NOTES_DIR
  process.env.DSH_QUICK_NOTES_DIR = directory
  const routes = []
  const cleanups = []
  try {
    apply(fakeContext(routes, cleanups))
    const byPath = new Map(routes.map((route) => [route.path, route.handler]))

    const healthResponse = fakeResponse()
    await byPath.get(HEALTH_PATH)(
      fakeRequest({ method: 'GET', headers: { host: '127.0.0.1:58587' } }),
      healthResponse,
    )
    assert.equal(healthResponse.status, 200)
    const health = jsonBody(healthResponse)
    assert.equal(health.ok, true)
    assert.equal(health.storage, 'file')
    assert.equal(typeof health.version, 'string')

    const state = {
      schemaVersion: 1,
      savedAt: 42,
      notes: [],
      trash: [],
      activeId: null,
      settings: { fontSize: 15, lineHeight: 1.75 },
      ui: { mode: 'normal' },
    }
    const putResponse = fakeResponse()
    await byPath.get(STATE_PATH)(
      fakeRequest({
        method: 'PUT',
        headers: { host: '127.0.0.1:58587', 'content-type': 'application/json' },
        body: JSON.stringify({ ok: true, state }),
      }),
      putResponse,
    )
    assert.equal(putResponse.status, 200)

    const getResponse = fakeResponse()
    await byPath.get(STATE_PATH)(
      fakeRequest({ method: 'GET', headers: { host: '127.0.0.1:58587' } }),
      getResponse,
    )
    assert.equal(getResponse.status, 200)
    assert.deepEqual(jsonBody(getResponse).state, state)

    const denied = fakeResponse()
    await byPath.get(STATE_PATH)(
      fakeRequest({ method: 'GET', headers: { host: 'evil.example' } }),
      denied,
    )
    assert.equal(denied.status, 403)
  } finally {
    if (previous === undefined) delete process.env.DSH_QUICK_NOTES_DIR
    else process.env.DSH_QUICK_NOTES_DIR = previous
    await cleanup()
  }
})
