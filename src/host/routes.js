/**
 * HTTP handlers for the plugin's two routes.
 *
 * The Web server hands the raw Node request/response pair over, so this module
 * owns status codes, headers, bodies and failure text. Only `node:` builtins and
 * local modules are imported: a profile-installed package cannot resolve the
 * installation's `@deepseek-ai/*` packages.
 *
 * Security model:
 *   - every request passes the same-origin fence in fence.js before dispatch;
 *   - PUT bodies are JSON only, capped at MAX_REQUEST_BYTES, and validated
 *     against the persisted-state envelope;
 *   - responses carry nosniff / same-origin / no-referrer headers.
 */
import {
  HEALTH_PATH,
  MAX_DIAGNOSTIC_BYTES,
  MAX_REQUEST_BYTES,
  STATE_PATH,
} from '../shared/constants.js'
import { createDiagnosticLog } from './diagnostics.js'
import { createStateStore, validateStatePayload } from './store.js'

/** Headers every response carries. */
const SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
})

/**
 * Merge the security headers with route-specific ones.
 * @param extra - route headers.
 * @returns the merged header object.
 */
function withSecurityHeaders(extra = {}) {
  return { ...SECURITY_HEADERS, ...extra }
}

/**
 * Write a JSON response.
 * @param response - Node response.
 * @param status - HTTP status code.
 * @param value - JSON-serialisable payload.
 * @param headers - extra headers.
 */
function sendJson(response, status, value, headers = {}) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
  response.writeHead(
    status,
    withSecurityHeaders({
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(body.byteLength),
      'cache-control': 'no-store',
      ...headers,
    }),
  )
  response.end(body)
}

/**
 * Write a plain-text failure.
 * @param response - Node response.
 * @param status - HTTP status code.
 * @param message - one line of human-readable text.
 * @param headers - extra headers.
 */
function sendError(response, status, message, headers = {}) {
  const body = Buffer.from(`${message}\n`, 'utf8')
  response.writeHead(
    status,
    withSecurityHeaders({
      'content-type': 'text/plain; charset=utf-8',
      'content-length': String(body.byteLength),
      'cache-control': 'no-store',
      ...headers,
    }),
  )
  response.end(body)
}

/**
 * The request method, uppercased.
 * @param request - Node request.
 * @returns the method.
 */
function methodOf(request) {
  return (request.method ?? 'GET').toUpperCase()
}

/**
 * Whether the request declares a JSON body.
 * @param request - Node request.
 * @returns whether the content type is JSON.
 */
function isJsonRequest(request) {
  const value = String(request.headers?.['content-type'] ?? '').toLowerCase()
  return value.startsWith('application/json')
}

/**
 * Read a request body with a hard byte cap.
 * @param request - Node request.
 * @param limit - maximum accepted bytes.
 * @returns the UTF-8 body text.
 * @throws an error with `status = 413` when the body exceeds the cap.
 */
async function readBody(request, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) {
      const error = new Error('request body too large')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Create the route handlers.
 * @param options - `directory`, `version`, `logger`, `fence`.
 * @returns the handlers and the underlying store.
 */
export function createHandlers({ directory, version, logger = null, fence }) {
  const store = createStateStore({ directory, logger })
  const diagnostics = createDiagnosticLog({ directory })

  /**
   * GET/PUT /dsh-quick-notes/state.
   * @param request - Node request.
   * @param response - Node response.
   */
  async function state(request, response) {
    const verdict = fence(request)
    if (!verdict.ok) {
      sendError(response, verdict.status, `forbidden: ${verdict.reason}`)
      return
    }
    const method = methodOf(request)
    if (method === 'GET') {
      try {
        const result = await store.read()
        sendJson(response, 200, { ok: true, state: result.state, corrupt: result.corrupt })
      } catch (error) {
        logger?.warn?.(`quick-notes: GET ${STATE_PATH} failed: ${error?.message ?? error}`)
        sendError(response, 500, 'failed to read the notes state')
      }
      return
    }
    if (method !== 'PUT') {
      sendError(response, 405, 'method not allowed', { allow: 'GET, PUT' })
      return
    }
    if (!isJsonRequest(request)) {
      sendError(response, 415, 'content-type must be application/json')
      return
    }
    let text
    try {
      text = await readBody(request, MAX_REQUEST_BYTES)
    } catch (error) {
      sendError(response, error?.status ?? 400, error?.message ?? 'invalid request body')
      return
    }
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      sendError(response, 400, 'invalid JSON body')
      return
    }
    const validated = validateStatePayload(payload)
    if (!validated.ok) {
      sendError(response, 400, `invalid state: ${validated.reason}`)
      return
    }
    try {
      const result = await store.write(validated.state)
      sendJson(response, 200, { ok: true, savedAt: result.savedAt })
    } catch (error) {
      logger?.warn?.(`quick-notes: PUT ${STATE_PATH} failed: ${error?.message ?? error}`)
      sendError(response, 500, 'failed to write the notes state')
    }
  }

  /**
   * POST /dsh-quick-notes/diagnostic.
   *
   * Accepts one JSON diagnostic entry from the Client half. This is a
   * write-only log endpoint: it never returns stored data.
   * @param request - Node request.
   * @param response - Node response.
   */
  async function diagnostic(request, response) {
    const verdict = fence(request)
    if (!verdict.ok) {
      sendError(response, verdict.status, `forbidden: ${verdict.reason}`)
      return
    }
    if (methodOf(request) !== 'POST') {
      sendError(response, 405, 'method not allowed', { allow: 'POST' })
      return
    }
    if (!isJsonRequest(request)) {
      sendError(response, 415, 'content-type must be application/json')
      return
    }
    let text
    try {
      text = await readBody(request, MAX_DIAGNOSTIC_BYTES)
    } catch (error) {
      sendError(response, error?.status ?? 400, error?.message ?? 'invalid request body')
      return
    }
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      sendError(response, 400, 'invalid JSON body')
      return
    }
    const result = await diagnostics.append(payload)
    if (!result.ok) {
      // Invalid input is a 400; a failed disk write is a server error, so a
      // diagnostic endpoint that silently swallows failures cannot look healthy.
      const status = result.reason.startsWith('failed to write') ? 500 : 400
      sendError(response, status, result.reason)
      return
    }
    sendJson(response, 200, { ok: true })
  }

  /**
   * GET /dsh-quick-notes/health.
   * @param request - Node request.
   * @param response - Node response.
   */
  function health(request, response) {
    const verdict = fence(request)
    if (!verdict.ok) {
      sendError(response, verdict.status, `forbidden: ${verdict.reason}`)
      return
    }
    if (methodOf(request) !== 'GET') {
      sendError(response, 405, 'method not allowed', { allow: 'GET' })
      return
    }
    sendJson(response, 200, { ok: true, version, storage: 'file', path: HEALTH_PATH })
  }

  return { state, health, diagnostic, store, diagnostics }
}
