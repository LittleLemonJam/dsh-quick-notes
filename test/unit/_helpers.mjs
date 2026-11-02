/**
 * Shared test helpers (not a test file: the `*.test.mjs` glob skips it).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Create a disposable directory and return its path plus a cleanup function.
 * @param prefix - directory name prefix.
 * @returns `{ directory, cleanup }`.
 */
export async function temporaryDirectory(prefix = 'dsh-quick-notes-') {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  return {
    directory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}

/**
 * Minimal localStorage-like object backed by a Map.
 * @param initial - optional initial entries.
 * @returns the storage object with the Map exposed as `map`.
 */
export function fakeLocalStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
  }
}

/**
 * Build a fake Node request for a route handler.
 * @param options - method, headers and body text.
 * @returns an async-iterable request object.
 */
export function fakeRequest({ method = 'GET', headers = {}, body = '' } = {}) {
  const chunks = body === '' ? [] : [Buffer.from(body, 'utf8')]
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

/**
 * Build a fake Node response that records status, headers and body.
 * @returns the response recorder.
 */
export function fakeResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = body === undefined ? '' : String(body)
    },
  }
}

/**
 * Parse a JSON response body.
 * @param response - fake response recorder.
 * @returns the parsed body.
 */
export function jsonBody(response) {
  return JSON.parse(response.body)
}
