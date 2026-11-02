/**
 * Notes store: the single mutable source for the Client half.
 *
 * Design rules:
 *   - `getState()` returns the same object until something actually changes,
 *     so `useSyncExternalStore` can rely on reference identity;
 *   - every action is synchronous and updates memory first, persistence runs
 *     behind a debounce (localStorage mirror + Host route);
 *   - components subscribe through `useStoreState` (the only React surface in
 *     this module); tests drive the actions directly without a DOM.
 */
import React from 'react'
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MAX_NOTE_HTML_LENGTH,
  MAX_NOTES,
  MAX_TRASH,
  SCHEMA_VERSION,
  WINDOW_EDGE_MARGIN,
  WINDOW_TOP_INSET,
} from '../shared/constants.js'
import { sanitizeHtml } from '../shared/sanitize.js'
import { clampRect } from './components/geometry.js'
import { currentViewport } from './dom.js'
import { serializeForPersist } from './storage.js'
import { reportDiagnostic } from './diagnostics.js'
import {
  clampSettings,
  clampUi,
  createInitialState,
  createNote,
  findNote,
  findTrashedNote,
  migrateState,
  normalizeTitle,
  sortNotes,
  UI_MODES,
  VIEWS,
} from '../shared/model.js'

/** How long edits are batched before one persistence round. */
const SAVE_DEBOUNCE_MS = 500

/** How long a failed Host write waits before retrying. */
const SAVE_RETRY_MS = 30_000

/** Delays before retrying the boot-time Host reconciliation. */
const HOST_RETRY_DELAYS = Object.freeze([1000, 3000, 8000])

/**
 * Subscribe a component to the whole store snapshot.
 * @param store - notes store.
 * @returns the current state.
 */
export function useStoreState(store) {
  return React.useSyncExternalStore(store.subscribe, store.getState, store.getState)
}

/**
 * Create the notes store.
 * @param options - `storage` adapter, optional clock.
 * @returns the store handle.
 */
export function createNotesStore({ storage, now = () => Date.now() }) {
  let state = createInitialState(now(), currentViewport())
  const listeners = new Set()
  let saveTimer = null
  let retryTimer = null
  let hostRetryTimer = null
  let hostRetryAttempts = 0
  let saveChain = Promise.resolve()
  let dirty = false
  let changeSeq = 0
  let disposed = false
  let unlistenPageHide = null

  /**
   * Replace the state and notify subscribers.
   * @param next - next state object.
   */
  function setState(next) {
    state = next
    for (const listener of listeners) listener()
  }

  /**
   * Update the sync slice without touching the rest of the state.
   * @param phase - new phase.
   * @param message - optional message key.
   */
  function setSync(phase, message) {
    setState({
      ...state,
      sync: { phase, message, at: now() },
    })
  }

  /**
   * Cancel the pending debounce.
   */
  function clearSaveTimer() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  /**
   * Cancel the pending retry.
   */
  function clearRetryTimer() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  /**
   * Write the current snapshot to localStorage and the Host.
   * @param keepalive - keep the Host request alive across page unload.
   * @returns the persistence promise.
   */
  function persistNow(keepalive = false) {
    if (disposed) return Promise.resolve()
    clearSaveTimer()
    clearRetryTimer()
    const snapshot = state
    const seq = changeSeq
    if (!dirty && snapshot.sync.phase === 'synced') return saveChain
    dirty = false
    try {
      storage.writeLocalState(snapshot)
    } catch {
      /* the mirror is best effort */
    }
    setSync('syncing')
    saveChain = saveChain
      .then(async () => {
        await storage.saveRemoteState(snapshot, keepalive)
        if (disposed) return
        if (seq === changeSeq) {
          dirty = false
          setSync('synced')
        } else {
          // A newer edit landed while this request was in flight; keep the
          // pending write alive instead of declaring the state saved.
          setSync('syncing')
          scheduleSave()
        }
      })
      .catch(() => {
        if (disposed) return
        dirty = true
        setSync('error', 'sync.host')
        clearRetryTimer()
        retryTimer = setTimeout(() => {
          retryTimer = null
          void persistNow()
        }, SAVE_RETRY_MS)
      })
    return saveChain
  }

  /**
   * Mark the state dirty and schedule one persistence round.
   */
  function scheduleSave() {
    if (disposed) return
    dirty = true
    clearSaveTimer()
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persistNow()
    }, SAVE_DEBOUNCE_MS)
  }

  /**
   * Apply one mutation and schedule persistence.
   * @param mutate - pure updater returning the next state (or the same state).
   */
  function commit(mutate) {
    const next = mutate(state)
    if (next === state) return
    changeSeq += 1
    setState(next)
    scheduleSave()
  }

  /**
   * Replace one note in place, preserving list order.
   * @param id - note id.
   * @param change - updater returning the next note.
   */
  function updateNote(id, change) {
    const current = findNote(state, id)
    if (current === undefined) return
    const next = change(current)
    if (next === current) return
    commit((previous) => ({
      ...previous,
      savedAt: now(),
      notes: previous.notes.map((note) => (note.id === id ? next : note)),
    }))
  }

  /**
   * Whether the given value is an allowed view.
   * @param view - candidate.
   * @returns whether it is a known view.
   */
  function isView(view) {
    return VIEWS.includes(view)
  }

  /**
   * Flush pending work when the page goes away.
   */
  function onPageHide() {
    if (dirty) void persistNow(true)
  }

  /**
   * Adopt a whole Host copy and make the editor reload its DOM.
   * @param remote - remote runtime state.
   */
  function adoptRemote(remote) {
    setState({
      ...remote,
      ready: true,
      view: state.view,
      // A whole-state replacement must reach the editor even when the active
      // note id did not change; the editor keys its DOM reload on this epoch
      // instead of the id alone.
      contentEpoch: (state.contentEpoch ?? 0) + 1,
      sync: { phase: 'synced', at: now() },
    })
    try {
      storage.writeLocalState(state)
    } catch {
      /* mirror is best effort */
    }
  }

  /**
   * Reconcile with the Host once: adopt a newer copy, or push the local one.
   * @returns whether the Host answered.
   */
  async function reconcileRemote() {
    let remote = null
    try {
      remote = await storage.loadRemoteState()
    } catch {
      return { ok: false }
    }
    if (disposed) return { ok: true }
    const localSavedAt = state.savedAt ?? 0
    if (remote !== null && remote.savedAt > localSavedAt && !dirty) {
      adoptRemote(remote)
      reportDiagnostic('sync.start', {
        host: true,
        usedRemote: true,
        mode: state.ui.mode,
        localSavedAt,
        remoteSavedAt: remote.savedAt,
      })
      return { ok: true }
    }
    setSync('syncing')
    dirty = true
    await persistNow()
    reportDiagnostic('sync.start', {
      host: true,
      usedRemote: false,
      mode: state.ui.mode,
      localSavedAt,
      remoteSavedAt: remote?.savedAt ?? 0,
    })
    return { ok: true }
  }

  /**
   * Retry the Host reconciliation when the Host half was not ready yet at boot
   * (a live plugin reload can race the Host route registration).
   */
  function scheduleHostRetry() {
    if (disposed) return
    const index = Math.min(hostRetryAttempts, HOST_RETRY_DELAYS.length - 1)
    const delay = HOST_RETRY_DELAYS[index]
    hostRetryAttempts += 1
    hostRetryTimer = setTimeout(async () => {
      hostRetryTimer = null
      if (disposed) return
      const result = await reconcileRemote()
      reportDiagnostic('sync.retry', {
        attempt: hostRetryAttempts,
        ok: result.ok,
        mode: state.ui.mode,
      })
      if (!result.ok && hostRetryAttempts < HOST_RETRY_DELAYS.length) scheduleHostRetry()
    }, delay)
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /**
     * Load the local mirror, reconcile it with the Host copy, then go ready.
     * @returns a promise resolved when the first paint state is settled.
     */
    async start() {
      if (disposed) return
      if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', onPageHide)
        unlistenPageHide = () => window.removeEventListener('pagehide', onPageHide)
      }
      let local = null
      try {
        local = storage.readLocalState()
      } catch {
        local = null
      }
      if (local !== null) {
        setState({
          ...local,
          ready: false,
          view: 'notes',
          sync: { phase: 'local', at: now() },
        })
      }
      let remote = null
      let hostAvailable = true
      try {
        remote = await storage.loadRemoteState()
      } catch {
        hostAvailable = false
      }
      if (disposed) return
      const localSavedAt = local?.savedAt ?? 0
      const useRemote = remote !== null && remote.savedAt > localSavedAt && !dirty
      if (useRemote) {
        adoptRemote(remote)
        reportDiagnostic('sync.start', {
          host: true,
          usedRemote: true,
          mode: state.ui.mode,
          localSavedAt,
          remoteSavedAt: remote.savedAt,
        })
        return
      }
      setState({
        ...state,
        ready: true,
        sync: {
          phase: hostAvailable
            ? dirty || local !== null || remote !== null
              ? 'syncing'
              : 'local'
            : 'local',
          at: now(),
        },
      })
      if (hostAvailable) {
        dirty = true
        await persistNow()
        reportDiagnostic('sync.start', {
          host: true,
          usedRemote: false,
          mode: state.ui.mode,
          localSavedAt,
          remoteSavedAt: remote?.savedAt ?? 0,
        })
      } else {
        reportDiagnostic('sync.start', {
          host: false,
          usedRemote: false,
          mode: state.ui.mode,
          localSavedAt,
          remoteSavedAt: 0,
        })
        scheduleHostRetry()
      }
    },
    dispose() {
      disposed = true
      clearSaveTimer()
      clearRetryTimer()
      if (hostRetryTimer !== null) {
        clearTimeout(hostRetryTimer)
        hostRetryTimer = null
      }
      unlistenPageHide?.()
      unlistenPageHide = null
      listeners.clear()
    },
    actions: {
      /**
       * Create a note and select it.
       * @param title - display title.
       * @returns the new note id, or null when the directory is full.
       */
      createNote(title) {
        if (state.notes.length >= MAX_NOTES) return null
        const note = createNote(title, now())
        commit((previous) => ({
          ...previous,
          savedAt: now(),
          notes: [note, ...previous.notes],
          activeId: note.id,
          view: 'notes',
        }))
        return note.id
      },
      /**
       * Rename one note.
       * @param id - note id.
       * @param title - new title.
       */
      renameNote(id, title) {
        const current = findNote(state, id)
        if (current === undefined) return
        const nextTitle = normalizeTitle(title, current.title)
        if (nextTitle === current.title) return
        updateNote(id, (note) => ({ ...note, title: nextTitle, updatedAt: now() }))
      },
      /**
       * Replace one note's HTML.
       * @param id - note id.
       * @param html - editor HTML.
       */
      setNoteHtml(id, html) {
        const text = typeof html === 'string' ? html.slice(0, MAX_NOTE_HTML_LENGTH) : ''
        updateNote(id, (note) =>
          note.html === text ? note : { ...note, html: text, updatedAt: now() },
        )
      },
      /**
       * Toggle one note's pinned flag.
       * @param id - note id.
       */
      togglePin(id) {
        updateNote(id, (note) => ({ ...note, pinned: !note.pinned }))
      },
      /**
       * Soft-delete one note into the recycle bin.
       * @param id - note id.
       */
      trashNote(id) {
        const note = findNote(state, id)
        if (note === undefined) return
        commit((previous) => {
          const notes = previous.notes.filter((item) => item.id !== id)
          const trashed = { ...note, deletedAt: now() }
          const trash = [trashed, ...previous.trash].slice(0, MAX_TRASH)
          const activeId =
            previous.activeId === id ? (sortNotes(notes)[0]?.id ?? null) : previous.activeId
          return { ...previous, savedAt: now(), notes, trash, activeId }
        })
      },
      /**
       * Restore one note from the recycle bin.
       * @param id - note id.
       */
      restoreNote(id) {
        const trashed = findTrashedNote(state, id)
        if (trashed === undefined) return
        commit((previous) => {
          const { deletedAt, ...note } = trashed
          void deletedAt
          return {
            ...previous,
            savedAt: now(),
            notes: [{ ...note, updatedAt: now() }, ...previous.notes],
            trash: previous.trash.filter((item) => item.id !== id),
            activeId: note.id,
            view: 'notes',
          }
        })
      },
      /**
       * Delete one trashed note forever.
       * @param id - note id.
       */
      purgeNote(id) {
        commit((previous) => ({
          ...previous,
          savedAt: now(),
          trash: previous.trash.filter((item) => item.id !== id),
        }))
      },
      /** Empty the recycle bin. */
      emptyTrash() {
        if (state.trash.length === 0) return
        commit((previous) => ({ ...previous, savedAt: now(), trash: [] }))
      },
      /**
       * Select the active note.
       * @param id - note id or null.
       */
      selectNote(id) {
        const next = id !== null && findNote(state, id) !== undefined ? id : null
        if (next === state.activeId) return
        commit((previous) => ({ ...previous, savedAt: now(), activeId: next }))
      },
      /**
       * Switch the directory column view.
       * @param view - notes, trash or settings.
       */
      setView(view) {
        if (!isView(view) || view === state.view) return
        setState({ ...state, view })
      },
      /**
       * Patch editor preferences.
       * @param patch - partial settings.
       */
      updateSettings(patch) {
        const settings = clampSettings({ ...state.settings, ...patch }, state.settings)
        if (JSON.stringify(settings) === JSON.stringify(state.settings)) return
        commit((previous) => ({ ...previous, savedAt: now(), settings }))
      },
      /**
       * Patch persisted window state.
       * @param patch - partial UI state.
       */
      updateUi(patch) {
        const ui = clampUi({ ...state.ui, ...patch }, state.ui)
        if (JSON.stringify(ui) === JSON.stringify(state.ui)) return
        commit((previous) => ({ ...previous, savedAt: now(), ui }))
      },
      /**
       * Switch the floating surface mode.
       * @param mode - normal, compact, ball or hidden.
       */
      setMode(mode) {
        if (!UI_MODES.includes(mode) || mode === state.ui.mode) return
        commit((previous) => ({
          ...previous,
          savedAt: now(),
          ui: clampUi({ ...previous.ui, mode }, previous.ui),
        }))
        // Mode transitions are the hardest thing to debug from a screenshot:
        // record where the surface went so a headless check can confirm it.
        // `message` is in every diagnostic whitelist, so the geometry survives
        // even when a running Host predates the structured fields.
        const viewport = currentViewport()
        reportDiagnostic('mode', {
          mode,
          message: `viewport=${viewport.width}x${viewport.height} rect=${state.ui.rect.x},${state.ui.rect.y},${state.ui.rect.width}x${state.ui.rect.height} ball=${state.ui.ball.x},${state.ui.ball.y}`,
        })
      },
      /**
       * Restore the floating window to its default size, keeping its position
       * (clamped into the viewport) and leaving compact mode.
       */
      resetWindowSize() {
        const rect = clampRect(
          {
            x: state.ui.rect.x,
            y: state.ui.rect.y,
            width: DEFAULT_WINDOW_WIDTH,
            height: DEFAULT_WINDOW_HEIGHT,
          },
          currentViewport(),
        )
        commit((previous) => ({
          ...previous,
          savedAt: now(),
          ui: clampUi(
            {
              ...previous.ui,
              mode: 'normal',
              compactRect: null,
              rect,
            },
            previous.ui,
          ),
        }))
      },
      /**
       * Move the floating window to its default place: the right-middle of the
       * DSH frame, below the native title bar, keeping the current size.
       */
      resetWindowPosition() {
        const viewport = currentViewport()
        const rect = state.ui.rect
        const x = Math.max(
          WINDOW_EDGE_MARGIN,
          Math.round(viewport.width - rect.width - WINDOW_EDGE_MARGIN),
        )
        const y = Math.max(WINDOW_TOP_INSET, Math.round((viewport.height - rect.height) / 2))
        const placed = clampRect({ x, y, width: rect.width, height: rect.height }, viewport)
        commit((previous) => ({
          ...previous,
          savedAt: now(),
          ui: clampUi(
            {
              ...previous.ui,
              mode: 'normal',
              compactRect: null,
              rect: placed,
            },
            previous.ui,
          ),
        }))
      },
      /**
       * Move one note to a display index inside its pinned/unpinned group.
       * @param id - note id.
       * @param toIndex - target index in `sortNotes(state.notes)` order.
       */
      moveNote(id, toIndex) {
        const note = findNote(state, id)
        if (note === undefined) return
        const sorted = sortNotes(state.notes)
        const from = sorted.findIndex((item) => item.id === id)
        if (from < 0) return
        let start = 0
        let end = sorted.length
        if (note.pinned === true) {
          const firstUnpinned = sorted.findIndex((item) => item.pinned !== true)
          if (firstUnpinned >= 0) end = firstUnpinned
        } else {
          const firstUnpinned = sorted.findIndex((item) => item.pinned !== true)
          if (firstUnpinned >= 0) start = firstUnpinned
        }
        if (end <= start) return
        const wanted = Number.isFinite(toIndex) ? Math.round(toIndex) : from
        const target = Math.min(end - 1, Math.max(start, wanted))
        if (target === from) return
        const next = sorted.slice()
        next.splice(from, 1)
        next.splice(target, 0, note)
        commit((previous) => ({ ...previous, savedAt: now(), notes: next }))
      },
      /**
       * Replace the notes from an exported payload.
       * @param raw - exported payload or its `state` field.
       * @returns whether the import succeeded.
       */
      importState(raw) {
        const candidate =
          raw !== null && typeof raw === 'object' && 'state' in raw ? raw.state : raw
        const migrated = migrateState(candidate, now())
        if (migrated === null) return { ok: false, message: 'invalid' }
        // An imported backup may come from anywhere: run it through the same
        // whitelist as the persistence boundary before it reaches the editor.
        const notes = migrated.notes.map((note) => ({
          ...note,
          html: sanitizeHtml(note.html),
        }))
        const trash = migrated.trash.map((note) => ({
          ...note,
          html: sanitizeHtml(note.html),
        }))
        commit((previous) => ({
          ...previous,
          savedAt: now(),
          schemaVersion: SCHEMA_VERSION,
          notes,
          trash,
          activeId: migrated.activeId,
          settings: migrated.settings,
          view: 'notes',
          contentEpoch: (previous.contentEpoch ?? 0) + 1,
        }))
        return { ok: true }
      },
      /**
       * Build the export payload.
       * @returns the persisted payload.
       */
      exportState() {
        // The exported backup must carry exactly the markup persistence would
        // accept, so it goes through the same sanitiser as the write path.
        return serializeForPersist(state)
      },
      /**
       * Flush pending persistence immediately.
       * @param keepalive - keep the Host request alive across page unload.
       * @returns the persistence promise.
       */
      flush(keepalive = false) {
        return persistNow(keepalive)
      },
    },
  }
}
