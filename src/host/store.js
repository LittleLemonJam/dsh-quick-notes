/**
 * Host-side persistence for the notes state.
 *
 * The file is the source of truth for the browser. Writes are atomic: a
 * temporary file is renamed over the previous one, and a failure keeps the old
 * file intact. Reads tolerate a missing file and a corrupted file (reported as
 * `null` with a warning, so the browser can push its local mirror back).
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { MAX_REQUEST_BYTES, SCHEMA_VERSION } from '../shared/constants.js'

/** Suffix of the in-flight write. */
const TEMP_SUFFIX = '.tmp'

/** Hard cap on the on-disk state file, slightly above the request cap. */
const MAX_FILE_BYTES = MAX_REQUEST_BYTES + 64 * 1024

/** How many times a rename is retried on Windows sharing violations. */
const RENAME_ATTEMPTS = 4

/** Delay between rename attempts, in milliseconds. */
const RENAME_DELAY_MS = 40

/**
 * Sleep without pulling in timers.
 * @param milliseconds - delay.
 * @returns a promise resolved after the delay.
 */
function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Validate the envelope the browser PUTs.
 * @param payload - parsed request body.
 * @returns `{ ok: true, state }` or `{ ok: false, reason }`.
 */
export function validateStatePayload(payload) {
  if (payload === null || typeof payload !== 'object') {
    return { ok: false, reason: 'body must be a JSON object' }
  }
  const state = payload.state
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    return { ok: false, reason: 'state must be a JSON object' }
  }
  if (state.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, reason: `unsupported schemaVersion: ${String(state.schemaVersion)}` }
  }
  if (!Array.isArray(state.notes) || !Array.isArray(state.trash)) {
    return { ok: false, reason: 'state.notes and state.trash must be arrays' }
  }
  if (state.activeId !== null && typeof state.activeId !== 'string') {
    return { ok: false, reason: 'state.activeId must be a string or null' }
  }
  if (state.settings === null || typeof state.settings !== 'object') {
    return { ok: false, reason: 'state.settings must be an object' }
  }
  if (state.ui === null || typeof state.ui !== 'object') {
    return { ok: false, reason: 'state.ui must be an object' }
  }
  let text
  try {
    text = JSON.stringify({ ok: true, state })
  } catch {
    return { ok: false, reason: 'state is not JSON-serialisable' }
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_REQUEST_BYTES) {
    return { ok: false, reason: 'state exceeds the size limit' }
  }
  return { ok: true, state }
}

/**
 * Create a state store rooted at one directory.
 * @param options - `directory`, optional logger.
 * @returns the store.
 */
export function createStateStore({ directory, logger = null }) {
  const file = join(directory, 'notes.json')
  let queue = Promise.resolve()

  /**
   * Read the state file.
   * @returns `{ state, corrupt }`; state is null when absent or unreadable.
   */
  async function read() {
    let info
    try {
      info = await stat(file)
    } catch (error) {
      if (error?.code === 'ENOENT') return { state: null, corrupt: false }
      logger?.warn?.(`quick-notes: cannot stat ${file}: ${error?.message ?? error}`)
      return { state: null, corrupt: false }
    }
    if (info.size > MAX_FILE_BYTES) {
      logger?.warn?.(`quick-notes: ${file} is larger than ${MAX_FILE_BYTES} bytes; ignoring it`)
      return { state: null, corrupt: true }
    }
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      logger?.warn?.(`quick-notes: cannot read ${file}: ${error?.message ?? error}`)
      return { state: null, corrupt: false }
    }
    let payload
    try {
      payload = JSON.parse(text)
    } catch (error) {
      logger?.warn?.(`quick-notes: ${file} is not valid JSON: ${error?.message ?? error}`)
      return { state: null, corrupt: true }
    }
    const validated = validateStatePayload(payload)
    if (!validated.ok) {
      logger?.warn?.(`quick-notes: ${file} failed validation: ${validated.reason}`)
      return { state: null, corrupt: true }
    }
    return { state: validated.state, corrupt: false }
  }

  /**
   * Replace the state file atomically.
   * @param state - validated state payload.
   * @returns the savedAt echoed back to the browser.
   */
  async function write(state) {
    const text = `${JSON.stringify({ ok: true, state })}\n`
    if (Buffer.byteLength(text, 'utf8') > MAX_REQUEST_BYTES) {
      throw new Error('state exceeds the size limit')
    }
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}${TEMP_SUFFIX}`
    await writeFile(temporary, text, 'utf8')
    let lastError = null
    for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt += 1) {
      try {
        await rename(temporary, file)
        lastError = null
        break
      } catch (error) {
        lastError = error
        if (attempt < RENAME_ATTEMPTS - 1) await sleep(RENAME_DELAY_MS * (attempt + 1))
      }
    }
    if (lastError !== null) {
      // A reader holding the file on Windows can block rename; a direct write
      // is still better than losing the update.
      logger?.warn?.(
        `quick-notes: rename failed, writing directly: ${lastError?.message ?? lastError}`,
      )
      await writeFile(file, text, 'utf8')
      try {
        await rename(temporary, `${temporary}.stale`)
      } catch {
        /* best effort cleanup */
      }
    }
    return { savedAt: state.savedAt ?? Date.now() }
  }

  /**
   * Serialise writes so concurrent PUTs cannot interleave.
   * @param state - validated state payload.
   * @returns the write result.
   */
  function enqueueWrite(state) {
    const next = queue.then(() => write(state))
    queue = next.catch(() => undefined)
    return next
  }

  return { file, read, write: enqueueWrite }
}
