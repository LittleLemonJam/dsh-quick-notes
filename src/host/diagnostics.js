/**
 * Host-side diagnostic log.
 *
 * The Client half reports mount pings and uncaught errors here. It exists so a
 * maintainer can verify a headless installation (the browser page may not be
 * observable) and so a crashed render leaves evidence instead of a blank
 * window. Entries are JSON lines, size-capped, and written through one queue.
 */
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Default log file cap, in bytes. */
const DEFAULT_MAX_LOG_BYTES = 256 * 1024

/** Maximum accepted size of one diagnostic entry. */
const MAX_ENTRY_BYTES = 8 * 1024

/** Maximum length of a message field. */
const MAX_MESSAGE_LENGTH = 2000

/** Maximum length of a stack field. */
const MAX_STACK_LENGTH = 6000

/** Fields a diagnostic entry may carry. */
const ENTRY_KINDS = new Set([
  'mounted',
  'theme',
  'mode',
  'ball.mounted',
  'sync.start',
  'sync.retry',
  'window.error',
  'unhandledrejection',
  'render.error',
  'client.warning',
])

/**
 * Keep only known, size-limited fields.
 * @param raw - untrusted entry.
 * @returns the sanitised entry.
 */
export function sanitizeDiagnosticEntry(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const kind = typeof raw.kind === 'string' ? raw.kind.slice(0, 40) : ''
  if (!ENTRY_KINDS.has(kind)) return null
  const entry = { kind }
  if (typeof raw.message === 'string' && raw.message !== '') {
    entry.message = raw.message.slice(0, MAX_MESSAGE_LENGTH)
  }
  if (typeof raw.stack === 'string' && raw.stack !== '') {
    entry.stack = raw.stack.slice(0, MAX_STACK_LENGTH)
  }
  if (typeof raw.componentStack === 'string' && raw.componentStack !== '') {
    entry.componentStack = raw.componentStack.slice(0, MAX_STACK_LENGTH)
  }
  if (typeof raw.version === 'string' && raw.version !== '') {
    entry.version = raw.version.slice(0, 40)
  }
  if (typeof raw.mode === 'string' && raw.mode !== '') {
    entry.mode = raw.mode.slice(0, 20)
  }
  if (typeof raw.theme === 'string' && raw.theme !== '') {
    entry.theme = raw.theme.slice(0, 20)
  }
  if (typeof raw.preference === 'string' && raw.preference !== '') {
    entry.preference = raw.preference.slice(0, 20)
  }
  if (typeof raw.hostTheme === 'string' && raw.hostTheme !== '') {
    entry.hostTheme = raw.hostTheme.slice(0, 20)
  }
  if (typeof raw.build === 'string' && raw.build !== '') {
    entry.build = raw.build.slice(0, 40)
  }
  if (typeof raw.host === 'boolean') entry.host = raw.host
  if (typeof raw.usedRemote === 'boolean') entry.usedRemote = raw.usedRemote
  if (typeof raw.ok === 'boolean') entry.ok = raw.ok
  if (typeof raw.attempt === 'number' && Number.isFinite(raw.attempt)) entry.attempt = raw.attempt
  if (typeof raw.localSavedAt === 'number' && Number.isFinite(raw.localSavedAt)) {
    entry.localSavedAt = raw.localSavedAt
  }
  if (typeof raw.remoteSavedAt === 'number' && Number.isFinite(raw.remoteSavedAt)) {
    entry.remoteSavedAt = raw.remoteSavedAt
  }
  return entry
}

/**
 * Create the diagnostic log writer.
 * @param options - `directory`, optional byte cap and clock.
 * @returns the writer.
 */
export function createDiagnosticLog({
  directory,
  maxBytes = DEFAULT_MAX_LOG_BYTES,
  now = () => Date.now(),
}) {
  const file = join(directory, 'diagnostics.log')
  let queue = Promise.resolve()

  /**
   * Trim the log file to roughly half the cap when it grows past it.
   * @returns a promise resolved when trimming finished.
   */
  async function trimIfNeeded() {
    let info
    try {
      info = await stat(file)
    } catch {
      return
    }
    if (info.size <= maxBytes) return
    const text = await readFile(file, 'utf8')
    const keep = Math.max(1, Math.floor(maxBytes / 2))
    await writeFile(file, text.slice(-keep), 'utf8')
  }

  /**
   * Append one diagnostic entry.
   * @param raw - untrusted entry.
   * @returns `{ ok: true }` or `{ ok: false, reason, status? }`; a write failure
   *   reports 500 so the caller can tell it apart from invalid input.
   */
  function append(raw) {
    const entry = sanitizeDiagnosticEntry(raw)
    if (entry === null) return Promise.resolve({ ok: false, reason: 'unknown diagnostic kind' })
    const line = `${JSON.stringify({ at: now(), ...entry })}\n`
    if (Buffer.byteLength(line, 'utf8') > MAX_ENTRY_BYTES) {
      return Promise.resolve({ ok: false, reason: 'diagnostic entry is too large' })
    }
    const task = queue.then(async () => {
      await mkdir(directory, { recursive: true })
      await trimIfNeeded()
      await appendFile(file, line, 'utf8')
    })
    // A failed write must not poison the shared queue: a later entry is still
    // attempted when the directory or permissions recover.
    queue = task.catch(() => undefined)
    return task.then(
      () => ({ ok: true }),
      (error) => ({ ok: false, reason: `failed to write diagnostics: ${error?.message ?? error}` }),
    )
  }

  return { file, append }
}
