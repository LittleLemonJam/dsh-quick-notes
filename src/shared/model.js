/**
 * Pure state model for the notes plugin.
 *
 * Everything here is synchronous, DOM-free and IO-free so the rules can be
 * unit-tested in Node. The store (src/client/store.js) owns mutations and
 * persistence; this module owns shape, defaults, ordering and migration.
 *
 * Display order is part of the state: notes are stored in the order the user
 * sees them (newest first), and editing a note never reorders the list — only
 * pinning moves it into the pinned group. That is why `sortNotes` is stable.
 */
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MAX_NOTE_HTML_LENGTH,
  MAX_NOTES,
  MAX_TITLE_LENGTH,
  MAX_TRASH,
  SCHEMA_VERSION,
  WINDOW_EDGE_MARGIN,
  WINDOW_TOP_INSET,
} from './constants.js'

/** Default editor preferences. */
export const DEFAULT_SETTINGS = Object.freeze({
  fontSize: 15,
  lineHeight: 1.75,
  ruledLines: false,
  theme: 'system',
})

/** Theme preferences: follow the host, or pin the plugin to one palette. */
export const THEMES = Object.freeze(['system', 'light', 'dark'])

/** Allowed settings ranges. */
export const SETTINGS_LIMITS = Object.freeze({
  fontSize: { min: 13, max: 20, step: 1 },
  lineHeight: { min: 1.4, max: 2.0, step: 0.05 },
})

/** Default window geometry used when no persisted UI state exists. */
const DEFAULT_RECT = Object.freeze({
  x: 96,
  y: 96,
  width: DEFAULT_WINDOW_WIDTH,
  height: DEFAULT_WINDOW_HEIGHT,
})

/**
 * Default window rectangle: the right-middle of the DSH frame, below the native
 * title-bar drag region.
 * @param viewport - `{ width, height }` of the layout viewport.
 * @returns the default rectangle.
 */
function defaultWindowRect(viewport = { width: 1280, height: 800 }) {
  const width = Math.max(320, Math.round(Number(viewport?.width) || 1280))
  const height = Math.max(240, Math.round(Number(viewport?.height) || 800))
  return {
    x: Math.max(WINDOW_EDGE_MARGIN, width - DEFAULT_WINDOW_WIDTH - WINDOW_EDGE_MARGIN),
    y: Math.max(WINDOW_TOP_INSET, Math.round((height - DEFAULT_WINDOW_HEIGHT) / 2)),
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
  }
}

/** Sidebar width bounds, in CSS pixels. */
export const SIDEBAR_LIMITS = Object.freeze({ min: 120, max: 320, default: 176 })

/** Modes the floating surface can be in. */
export const UI_MODES = Object.freeze(['normal', 'compact', 'ball', 'hidden'])

/** Views the directory column can show. */
export const VIEWS = Object.freeze(['notes', 'trash', 'settings'])

/** Fallback title used when a caller passes an empty title without a translation. */
const FALLBACK_TITLE = 'Untitled'

/**
 * Clamp a number into an inclusive range, tolerating non-finite input.
 * @param value - candidate value.
 * @param min - lower bound.
 * @param max - upper bound.
 * @param fallback - value used when the input is not finite.
 * @returns the clamped number.
 */
function clampNumber(value, min, max, fallback) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, number))
}

/**
 * Normalise a note title: single-line, trimmed, length-limited, never empty.
 * @param title - raw title.
 * @param fallback - title used when the result would be empty.
 * @returns the normalised title.
 */
export function normalizeTitle(title, fallback = FALLBACK_TITLE) {
  const text = String(title ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
  if (text !== '') return text
  const fallbackText = String(fallback ?? '')
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
  return fallbackText !== '' ? fallbackText : FALLBACK_TITLE
}

/**
 * Build a collision-resistant note id.
 * @param now - epoch milliseconds.
 * @param random - random source returning [0, 1).
 * @returns the note id.
 */
export function createNoteId(now = Date.now(), random = Math.random) {
  const time = Math.max(0, Math.floor(now)).toString(36)
  const noise = Math.floor(random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0')
  return `n_${time}_${noise}`
}

/**
 * Create one note.
 * @param title - display title; empty values fall back to the default.
 * @param now - creation timestamp.
 * @param random - random source for the id.
 * @returns the note.
 */
export function createNote(title, now = Date.now(), random = Math.random) {
  return {
    id: createNoteId(now, random),
    title: normalizeTitle(title),
    html: '',
    pinned: false,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Create the initial runtime state.
 * @param now - epoch milliseconds.
 * @param viewport - browser viewport used to place the first window.
 * @returns the initial state.
 */
export function createInitialState(now = Date.now(), viewport = { width: 1280, height: 800 }) {
  const width = clampNumber(viewport?.width, 640, 100_000, 1280)
  const height = clampNumber(viewport?.height, 480, 100_000, 800)
  const rect = defaultWindowRect({ width, height })
  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: now,
    notes: [],
    trash: [],
    activeId: null,
    settings: { ...DEFAULT_SETTINGS },
    ui: {
      mode: 'normal',
      rect,
      compactRect: null,
      sidebarWidth: SIDEBAR_LIMITS.default,
      ball: { x: Math.max(16, width - 96), y: Math.max(16, height - 120) },
    },
    ready: false,
    view: 'notes',
    // Bumped whenever a whole state replaces the current one (Host adoption,
    // JSON import); the editor reloads its DOM when this changes even if the
    // active note id stays the same.
    contentEpoch: 0,
    sync: { phase: 'loading', at: now },
  }
}

/**
 * Stable directory order: pinned notes first, original order preserved inside
 * each group.
 * @param notes - notes array.
 * @returns a new sorted array.
 */
export function sortNotes(notes) {
  return notes
    .map((note, index) => ({ note, index }))
    .sort((left, right) => {
      if (left.note.pinned !== right.note.pinned) return left.note.pinned ? -1 : 1
      return left.index - right.index
    })
    .map((entry) => entry.note)
}

/**
 * Find a note by id.
 * @param state - state or any object with `notes`.
 * @param id - note id.
 * @returns the note or undefined.
 */
export function findNote(state, id) {
  if (id === null || id === undefined) return undefined
  return (state.notes ?? []).find((note) => note.id === id)
}

/**
 * Find a trashed note by id.
 * @param state - state or any object with `trash`.
 * @param id - note id.
 * @returns the trashed note or undefined.
 */
export function findTrashedNote(state, id) {
  return (state.trash ?? []).find((note) => note.id === id)
}

/**
 * Replace one note in place without changing list order.
 * @param notes - current notes.
 * @param note - replacement note.
 * @returns a new array.
 */
export function upsertNote(notes, note) {
  const index = notes.findIndex((item) => item.id === note.id)
  if (index < 0) return [note, ...notes]
  const next = notes.slice()
  next[index] = note
  return next
}

/**
 * Clamp settings to their allowed ranges.
 * @param settings - raw settings.
 * @param fallback - base settings for missing fields.
 * @returns normalised settings.
 */
export function clampSettings(settings, fallback = DEFAULT_SETTINGS) {
  const source = settings !== null && typeof settings === 'object' ? settings : {}
  return {
    fontSize: Math.round(
      clampNumber(
        source.fontSize,
        SETTINGS_LIMITS.fontSize.min,
        SETTINGS_LIMITS.fontSize.max,
        fallback.fontSize,
      ),
    ),
    lineHeight:
      Math.round(
        clampNumber(
          source.lineHeight,
          SETTINGS_LIMITS.lineHeight.min,
          SETTINGS_LIMITS.lineHeight.max,
          fallback.lineHeight,
        ) * 100,
      ) / 100,
    ruledLines:
      typeof source.ruledLines === 'boolean' ? source.ruledLines : fallback.ruledLines === true,
    theme: THEMES.includes(source.theme) ? source.theme : fallback.theme,
  }
}

/**
 * Normalise a rectangle.
 * @param rect - raw rectangle.
 * @param fallback - rectangle used for missing or invalid fields.
 * @returns normalised rectangle.
 */
export function normalizeRect(rect, fallback = DEFAULT_RECT) {
  const source = rect !== null && typeof rect === 'object' ? rect : {}
  return {
    x: Math.round(clampNumber(source.x, -100_000, 100_000, fallback.x)),
    y: Math.round(clampNumber(source.y, -100_000, 100_000, fallback.y)),
    width: Math.round(clampNumber(source.width, 320, 100_000, fallback.width)),
    height: Math.round(clampNumber(source.height, 240, 100_000, fallback.height)),
  }
}

/**
 * Clamp the persisted UI slice.
 * @param ui - raw UI state.
 * @param fallback - initial UI state.
 * @returns normalised UI state.
 */
export function clampUi(ui, fallback = createInitialState().ui) {
  const source = ui !== null && typeof ui === 'object' ? ui : {}
  const mode = UI_MODES.includes(source.mode) ? source.mode : fallback.mode
  const ballSource = source.ball !== null && typeof source.ball === 'object' ? source.ball : {}
  return {
    mode,
    rect: normalizeRect(source.rect, fallback.rect),
    compactRect:
      source.compactRect === null || source.compactRect === undefined
        ? null
        : normalizeRect(source.compactRect, fallback.rect),
    sidebarWidth: Math.round(
      clampNumber(
        source.sidebarWidth,
        SIDEBAR_LIMITS.min,
        SIDEBAR_LIMITS.max,
        fallback.sidebarWidth,
      ),
    ),
    ball: {
      x: Math.round(clampNumber(ballSource.x, -100_000, 100_000, fallback.ball.x)),
      y: Math.round(clampNumber(ballSource.y, -100_000, 100_000, fallback.ball.y)),
    },
  }
}

/**
 * Validate the loose shape a persisted payload must have.
 * @param raw - candidate payload.
 * @returns whether the payload is structurally usable.
 */
export function isValidPersistedState(raw) {
  return (
    raw !== null &&
    typeof raw === 'object' &&
    Array.isArray(raw.notes) &&
    Array.isArray(raw.trash) &&
    (raw.activeId === null || typeof raw.activeId === 'string')
  )
}

/**
 * Normalise one raw note.
 * @param raw - candidate note.
 * @param now - fallback timestamps.
 * @returns the normalised note, or null when unusable.
 */
function normalizeNote(raw, now) {
  if (raw === null || typeof raw !== 'object') return null
  if (typeof raw.id !== 'string' || raw.id.trim() === '') return null
  const createdAt = clampNumber(raw.createdAt, 0, Number.MAX_SAFE_INTEGER, now)
  const updatedAt = clampNumber(raw.updatedAt, 0, Number.MAX_SAFE_INTEGER, createdAt)
  return {
    id: raw.id.slice(0, 120),
    title: normalizeTitle(raw.title),
    html: typeof raw.html === 'string' ? raw.html.slice(0, MAX_NOTE_HTML_LENGTH) : '',
    pinned: raw.pinned === true,
    createdAt,
    updatedAt,
  }
}

/**
 * Normalise one raw trashed note.
 * @param raw - candidate note.
 * @param now - fallback timestamp.
 * @returns the normalised trashed note, or null.
 */
function normalizeTrashedNote(raw, now) {
  const note = normalizeNote(raw, now)
  if (note === null) return null
  return { ...note, deletedAt: clampNumber(raw.deletedAt, 0, Number.MAX_SAFE_INTEGER, now) }
}

/**
 * Migrate a persisted payload into the current schema.
 *
 * Unknown fields are dropped; invalid notes are skipped; `activeId` falls back
 * to the first visible note. Returns null only when the payload is not even
 * structurally a notes state, so callers can keep their current state.
 *
 * @param raw - candidate payload.
 * @param now - fallback timestamp.
 * @returns the migrated state, or null.
 */
export function migrateState(raw, now = Date.now()) {
  if (!isValidPersistedState(raw)) return null
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== SCHEMA_VERSION) return null
  const notes = []
  const seen = new Set()
  for (const item of raw.notes.slice(0, MAX_NOTES)) {
    const note = normalizeNote(item, now)
    if (note === null || seen.has(note.id)) continue
    seen.add(note.id)
    notes.push(note)
  }
  const trash = []
  for (const item of raw.trash.slice(0, MAX_TRASH)) {
    const note = normalizeTrashedNote(item, now)
    if (note === null || seen.has(note.id)) continue
    seen.add(note.id)
    trash.push(note)
  }
  const activeId =
    typeof raw.activeId === 'string' && notes.some((note) => note.id === raw.activeId)
      ? raw.activeId
      : (notes[0]?.id ?? null)
  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: clampNumber(raw.savedAt, 0, Number.MAX_SAFE_INTEGER, now),
    notes,
    trash,
    activeId,
    settings: clampSettings(raw.settings),
    ui: clampUi(raw.ui),
    ready: false,
    view: 'notes',
    // Bumped whenever a whole state replaces the current one (Host adoption,
    // JSON import); the editor reloads its DOM when this changes even if the
    // active note id stays the same.
    contentEpoch: 0,
    sync: { phase: 'loading', at: now },
  }
}

/**
 * Project the runtime state onto the persisted schema.
 * @param state - runtime state.
 * @returns the payload written to disk and localStorage.
 */
export function buildPersistedState(state) {
  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: clampNumber(state.savedAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
    notes: state.notes.map((note) => ({
      id: note.id,
      title: normalizeTitle(note.title),
      html: typeof note.html === 'string' ? note.html.slice(0, MAX_NOTE_HTML_LENGTH) : '',
      pinned: note.pinned === true,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    })),
    trash: state.trash.map((note) => ({
      id: note.id,
      title: normalizeTitle(note.title),
      html: typeof note.html === 'string' ? note.html.slice(0, MAX_NOTE_HTML_LENGTH) : '',
      pinned: note.pinned === true,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      deletedAt: note.deletedAt,
    })),
    activeId: state.activeId,
    settings: clampSettings(state.settings),
    ui: clampUi(state.ui),
  }
}
