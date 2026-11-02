/**
 * Persistence adapter for the notes store.
 *
 * Two layers:
 *   1. `localStorage` mirror — synchronous, always written, survives a Host
 *      restart and a page reload;
 *   2. the Host route `GET/PUT /dsh-quick-notes/state` — the durable copy in
 *      `$DSH_HOME/quick-notes/notes.json`, shared by every browser tab and by
 *      every port the Web GUI may listen on.
 *
 * Every write passes through `sanitizeHtml`, so neither layer can persist
 * markup the editor would refuse to render.
 */
import { MAX_NOTE_HTML_LENGTH, STATE_PATH } from '../shared/constants.js'
import { buildPersistedState, migrateState } from '../shared/model.js'
import { sanitizeHtml } from '../shared/sanitize.js'

/** localStorage key holding the mirror. */
export const LOCAL_STORAGE_KEY = 'dsh-quick-notes:state:v1'

/** Default request timeout, in milliseconds. */
const REQUEST_TIMEOUT_MS = 8000

/**
 * Sanitise one note's HTML for persistence.
 * @param note - runtime note.
 * @returns the persisted note.
 */
function sanitizeNote(note) {
  return {
    ...note,
    html: sanitizeHtml(typeof note.html === 'string' ? note.html : '').slice(
      0,
      MAX_NOTE_HTML_LENGTH,
    ),
  }
}

/**
 * Project a runtime state onto the persisted payload with clean HTML.
 * @param state - runtime state.
 * @returns the persisted payload.
 */
export function serializeForPersist(state) {
  const payload = buildPersistedState(state)
  return {
    ...payload,
    notes: payload.notes.map(sanitizeNote),
    trash: payload.trash.map(sanitizeNote),
  }
}

/**
 * localStorage can throw in privacy modes; treat it as unavailable.
 * @returns the storage object or null.
 */
function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * Read the local mirror.
 * @param storage - localStorage-like object.
 * @returns the raw parsed value, or null.
 */
export function readLocal(storage) {
  if (storage === null || storage === undefined) return null
  try {
    const text = storage.getItem(LOCAL_STORAGE_KEY)
    return text === null ? null : JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Write the local mirror.
 * @param storage - localStorage-like object.
 * @param payload - persisted payload.
 * @returns whether the write succeeded.
 */
export function writeLocal(storage, payload) {
  if (storage === null || storage === undefined) return false
  try {
    storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

/**
 * Fetch with a timeout.
 * @param fetchImpl - fetch implementation.
 * @param url - request URL.
 * @param init - fetch options.
 * @param timeoutMs - timeout in milliseconds.
 * @returns the response.
 */
async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Read the Host copy.
 * @param fetchImpl - fetch implementation.
 * @param endpoint - state route.
 * @param timeoutMs - request timeout.
 * @returns the persisted state, or null when the Host has no copy yet.
 * @throws when the Host is unreachable or answers with an error.
 */
export async function loadRemote(fetchImpl, endpoint = STATE_PATH, timeoutMs = REQUEST_TIMEOUT_MS) {
  const response = await fetchWithTimeout(
    fetchImpl,
    endpoint,
    {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    },
    timeoutMs,
  )
  if (!response.ok) throw new Error(`GET ${endpoint} failed with HTTP ${response.status}`)
  const payload = await response.json()
  if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
    throw new Error(`GET ${endpoint} returned an unexpected payload`)
  }
  return payload.state ?? null
}

/**
 * Write the Host copy.
 * @param fetchImpl - fetch implementation.
 * @param payload - persisted payload.
 * @param endpoint - state route.
 * @param timeoutMs - request timeout.
 * @param keepalive - whether the request should outlive the page.
 * @returns the savedAt reported by the Host.
 * @throws when the Host rejects or cannot store the state.
 */
export async function saveRemote(
  fetchImpl,
  payload,
  endpoint = STATE_PATH,
  timeoutMs = REQUEST_TIMEOUT_MS,
  keepalive = false,
) {
  const response = await fetchWithTimeout(
    fetchImpl,
    endpoint,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ ok: true, state: payload }),
      keepalive,
    },
    timeoutMs,
  )
  if (!response.ok) throw new Error(`PUT ${endpoint} failed with HTTP ${response.status}`)
  const body = await response.json()
  if (body === null || typeof body !== 'object' || body.ok !== true) {
    throw new Error(`PUT ${endpoint} returned an unexpected payload`)
  }
  return { savedAt: typeof body.savedAt === 'number' ? body.savedAt : payload.savedAt }
}

/**
 * Create the storage adapter the store talks to.
 * @param options - overrides for tests.
 * @returns the adapter.
 */
export function createStorage({
  fetchImpl = globalThis.fetch,
  storage = safeLocalStorage(),
  endpoint = STATE_PATH,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  return {
    endpoint,
    /**
     * Read the local mirror as a migrated runtime state.
     * @returns the state, or null.
     */
    readLocalState() {
      const raw = readLocal(storage)
      return raw === null ? null : migrateState(raw)
    },
    /**
     * Mirror a runtime state into localStorage.
     * @param state - runtime state.
     * @returns whether the write succeeded.
     */
    writeLocalState(state) {
      return writeLocal(storage, serializeForPersist(state))
    },
    /**
     * Read the Host copy as a migrated runtime state.
     * @returns the state, or null.
     */
    async loadRemoteState() {
      const raw = await loadRemote(fetchImpl, endpoint, timeoutMs)
      return raw === null ? null : migrateState(raw)
    },
    /**
     * Replace the Host copy.
     * @param state - runtime state.
     * @param keepalive - keep the request alive across page unload.
     * @returns the savedAt reported by the Host.
     */
    saveRemoteState(state, keepalive = false) {
      return saveRemote(fetchImpl, serializeForPersist(state), endpoint, timeoutMs, keepalive)
    },
  }
}
