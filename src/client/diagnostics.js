/**
 * Client-side diagnostics reporting.
 *
 * The plugin is a floating surface with no visible console: a render crash
 * would otherwise leave a blank overlay and no evidence. This module reports a
 * mount ping, render errors and uncaught page errors to the Host diagnostic log
 * (`$DSH_HOME/quick-notes/diagnostics.log`). Reporting is best effort, throttled
 * and never allowed to break the UI.
 */
import { DIAGNOSTIC_PATH } from '../shared/constants.js'

/** Minimum interval between two reports of the same key, in milliseconds. */
const REPORT_INTERVAL_MS = 5000

/** Maximum number of distinct keys remembered for throttling. */
const MAX_KEYS = 100

/** key -> last report timestamp. */
const lastReported = new Map()

/**
 * Report one diagnostic entry to the Host.
 * @param kind - one of the known kinds (see src/host/diagnostics.js).
 * @param detail - optional message/stack/version fields.
 */
export function reportDiagnostic(kind, detail = {}) {
  if (typeof window === 'undefined') return
  try {
    const key = `${kind}:${String(detail.message ?? '')}`
    const now = Date.now()
    const previous = lastReported.get(key)
    if (previous !== undefined && now - previous < REPORT_INTERVAL_MS) return
    if (lastReported.size >= MAX_KEYS) lastReported.clear()
    lastReported.set(key, now)
    const body = JSON.stringify({ kind, ...detail })
    if (body.length > 8000) return
    void fetch(DIAGNOSTIC_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      keepalive: true,
      body,
    }).catch(() => undefined)
  } catch {
    /* diagnostics must never throw into the UI */
  }
}

/**
 * Install page-level error reporting.
 * @returns a disposer removing the listeners.
 */
export function installErrorReporting() {
  if (typeof window === 'undefined') return () => {}
  const onError = (event) => {
    const error = event?.error
    reportDiagnostic('window.error', {
      message: String(event?.message ?? error?.message ?? 'unknown error'),
      stack: typeof error?.stack === 'string' ? error.stack : '',
    })
  }
  const onRejection = (event) => {
    const reason = event?.reason
    reportDiagnostic('unhandledrejection', {
      message: String(reason?.message ?? reason ?? 'unknown rejection'),
      stack: typeof reason?.stack === 'string' ? reason.stack : '',
    })
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
