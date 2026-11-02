/**
 * Constants shared by both halves of the plugin.
 *
 * Only data that the Host and the Client must agree on belongs here. Anything
 * that only one half needs lives next to that half.
 */

/** Persisted-state schema version. Bump together with a migration in model.js. */
export const SCHEMA_VERSION = 1

/** Maximum number of notes kept in the directory. */
export const MAX_NOTES = 500

/** Maximum number of soft-deleted notes kept in the recycle bin. */
export const MAX_TRASH = 100

/** Maximum note title length, in characters. */
export const MAX_TITLE_LENGTH = 80

/** Route namespace owned by this plugin. */
const ROUTE_ROOT = '/dsh-quick-notes'

/** State route: GET reads, PUT replaces the whole persisted state. */
export const STATE_PATH = `${ROUTE_ROOT}/state`

/** Read-only self-report used by install verification. */
export const HEALTH_PATH = `${ROUTE_ROOT}/health`

/** Client diagnostic reports (mount ping, render errors). */
export const DIAGNOSTIC_PATH = `${ROUTE_ROOT}/diagnostic`

/** Request body cap for PUT /state (bytes). Notes may carry pasted images. */
export const MAX_REQUEST_BYTES = 8 * 1024 * 1024

/** Request body cap for POST /diagnostic (bytes). */
export const MAX_DIAGNOSTIC_BYTES = 8 * 1024

/** Maximum accepted size of one note's HTML (characters). */
export const MAX_NOTE_HTML_LENGTH = 600_000

/** Default floating-window size, in CSS pixels. */
export const DEFAULT_WINDOW_WIDTH = 560
export const DEFAULT_WINDOW_HEIGHT = 440

/** Gap between the floating window and the DSH frame edges, in CSS pixels. */
export const WINDOW_EDGE_MARGIN = 24

/**
 * Top safe area: the DSH desktop title bar is a native drag region, so a window
 * dragged into it would move the whole application instead. Keep the floating
 * window below it.
 */
export const WINDOW_TOP_INSET = 64
