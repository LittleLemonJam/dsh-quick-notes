/**
 * Directory column: note list, create / rename / pin / delete / reorder, footer.
 *
 * `state.view` switches the column body between the notes list, the settings
 * panel (`components/settings.js`) and the recycle bin (`components/trash.js`);
 * the footer (settings gear, recycle bin badge, ruled-lines toggle, sync dot)
 * stays visible in every view. The panels bring their own back button.
 *
 * Rows can be reordered with Pointer Events: movement past `DRAG_THRESHOLD_PX`
 * starts a drag, the dragged row follows the pointer, other rows slide out of
 * the way, and the drop is committed once through `actions.moveNote`. The drop
 * math lives in pure helpers (`computeDropIndex`, `computeRowShift`,
 * `clampIndexWithinGroup`) so it can be unit-tested without a DOM. Alt+Up/Down
 * offers the same reorder from the keyboard.
 *
 * One `useInlineEdit` state machine drives both inline inputs (new-note draft
 * and rename); the panel primitives and shared helpers come from the leaf
 * module `components/trash.js`.
 */
import React from 'react'
import { clamp, cx, formatCount, h } from '../dom.js'
import { findNote, normalizeTitle, sortNotes } from '../../shared/model.js'
import { MAX_TITLE_LENGTH } from '../../shared/constants.js'
import { SettingsPanel, syncLabelKey } from './settings.js'
import { icon, textButton, TrashPanel } from './trash.js'

/** Pointer distance that starts a row drag, in CSS pixels. */
export const DRAG_THRESHOLD_PX = 4

/** Duration of the reorder settle animation, in ms (mirrors the CSS sheet). */
export const DRAG_ANIMATION_MS = 160

/** Localized copy. */
export const I18N = {
  en: {
    'sidebar.title': 'Notes',
    'sidebar.newNote': 'New note',
    'sidebar.newPlaceholder': 'Note name',
    'sidebar.rename': 'Rename note',
    'sidebar.renameHint': 'Double-click to rename',
    'sidebar.empty': 'No notes yet. Create the first one.',
    'sidebar.emptyAction': 'Create a note',
    'sidebar.pin': 'Pin note',
    'sidebar.unpin': 'Unpin note',
    'sidebar.pinMark': 'Pinned',
    'sidebar.delete': 'Move to recycle bin',
    'sidebar.settings': 'Settings',
    'sidebar.trash': 'Recycle bin',
    'sidebar.trashWithCount': 'Recycle bin ({n})',
    'sidebar.ruledLines': 'Ruled lines',
    'note.untitled': 'Untitled note',
  },
  zh: {
    'sidebar.title': '便签',
    'sidebar.newNote': '新建便签',
    'sidebar.newPlaceholder': '便签名称',
    'sidebar.rename': '重命名便签',
    'sidebar.renameHint': '双击可重命名',
    'sidebar.empty': '还没有便签，新建一条吧。',
    'sidebar.emptyAction': '新建便签',
    'sidebar.pin': '置顶',
    'sidebar.unpin': '取消置顶',
    'sidebar.pinMark': '已置顶',
    'sidebar.delete': '删除到回收站',
    'sidebar.settings': '设置',
    'sidebar.trash': '回收站',
    'sidebar.trashWithCount': '回收站（{n} 条）',
    'sidebar.ruledLines': '横线衬底',
    'note.untitled': '未命名便签',
  },
}

/** Component styles, one rule per line to keep the CSS-in-JS sheet compact. */
export const CSS = `
/* Column shell. The width comes from state.ui.sidebarWidth (inline style). */
.qn-sidebar { flex: 0 0 auto; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-layer-2); border-right: 1px solid var(--dsw-alias-border-l1); }
.qn-notes-view { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.qn-sidebar-head { display: flex; align-items: center; gap: 4px; padding: 8px 8px 4px 10px; flex: none; }
.qn-sidebar-title { flex: 1 1 auto; min-width: 0; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Note list and drag states. */
.qn-note-list { list-style: none; margin: 0; padding: 2px 6px 8px; display: flex; flex-direction: column; gap: 1px; flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.qn-note-row { display: flex; align-items: center; gap: 2px; min-height: 26px; padding: 1px 2px; border-radius: 6px; color: var(--dsw-alias-label-secondary); cursor: grab; transition: transform 160ms ease; }
.qn-note-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.qn-note-row[data-active='true'] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); color: var(--dsw-alias-label-primary); }
.qn-note-row .qn-note-select { cursor: grab; }
.qn-note-row[data-dragging='true'] { position: relative; z-index: 2; background: var(--dsw-alias-bg-overlay); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18); cursor: grabbing; transition: none; }
.qn-note-row[data-dragging='true'] .qn-note-actions { opacity: 0; }
.qn-note-list[data-dragging='true'] { user-select: none; cursor: grabbing; }
.qn-note-list[data-dragging='true'] .qn-note-select { cursor: grabbing; }
.qn-note-select { display: flex; align-items: center; gap: 5px; flex: 1 1 auto; min-width: 0; padding: 3px 4px; border-radius: 6px; text-align: left; color: inherit; }
.qn-note-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qn-note-pin { display: inline-flex; flex: none; color: var(--dsw-alias-brand-primary); }
.qn-note-pin .qn-icon { width: 12px; height: 12px; }
.qn-note-actions { display: flex; align-items: center; flex: none; padding-right: 2px; opacity: 0; transition: opacity 100ms ease; }
.qn-note-row:hover .qn-note-actions, .qn-note-row:focus-within .qn-note-actions { opacity: 1; }
.qn-note-action { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 4px; color: var(--dsw-alias-label-tertiary); }
.qn-note-action:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.qn-note-action[aria-pressed='true'] { color: var(--dsw-alias-brand-primary); }
.qn-note-action-danger:hover { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-interactive-bg-hover-danger); }
.qn-note-action .qn-icon { width: 13px; height: 13px; }

/* Inline create / rename input. */
.qn-note-input { width: 100%; min-width: 0; height: 24px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; outline: none; }
.qn-note-input::placeholder { color: var(--dsw-alias-label-secondary); }
.qn-note-input:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent); }

/* Empty state. The action button reuses the shared .qn-text-button style. */
.qn-note-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; flex: 1 1 auto; min-height: 0; padding: 14px 12px; overflow-y: auto; }
.qn-note-empty-text { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.6; }

/* Footer: settings gear, recycle bin with count badge, ruled lines, sync dot. */
.qn-sidebar-footer { display: flex; align-items: center; gap: 2px; padding: 5px 6px; flex: none; border-top: 1px solid var(--dsw-alias-border-l1); }
.qn-sidebar-spacer { flex: 1 1 auto; }
.qn-trash-button { position: relative; }
.qn-badge { position: absolute; top: -4px; right: -5px; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-inverted); font-size: 10px; font-weight: 600; line-height: 15px; text-align: center; pointer-events: none; }
.qn-sync-dot { width: 8px; height: 8px; margin: 0 5px; border-radius: 50%; flex: none; background: var(--dsw-alias-label-secondary); transition: background 160ms ease; }
.qn-sync-dot[data-phase='syncing'] { background: var(--dsw-alias-brand-primary); animation: qn-sync-pulse 1.1s ease-in-out infinite; }
.qn-sync-dot[data-phase='local'] { background: var(--dsw-alias-state-warn-primary); }
.qn-sync-dot[data-phase='synced'] { background: var(--dsw-alias-state-success-primary); }
.qn-sync-dot[data-phase='error'] { background: var(--dsw-alias-state-error-primary); }
@keyframes qn-sync-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .qn-sync-dot { transition: none; } .qn-sync-dot[data-phase='syncing'] { animation: none; } .qn-note-actions { transition: none; } .qn-note-row { transition: none; } }
`

/** Path children for one icon. */
const paths = (...draws) => draws.map((d, index) => h('path', { key: index, d }))

/** Plus glyph for the "new note" action. */
const plusGlyph = () => icon(paths('M12 5v14', 'M5 12h14'))

/** Settings glyph (sliders). */
const settingsGlyph = () =>
  icon([
    ...paths('M4 7h4M12 7h8', 'M4 12h9M17 12h3', 'M4 17h2M10 17h10'),
    h('circle', { key: 'c1', cx: 10, cy: 7, r: 2 }),
    h('circle', { key: 'c2', cx: 15, cy: 12, r: 2 }),
    h('circle', { key: 'c3', cx: 8, cy: 17, r: 2 }),
  ])

/** Pin (thumbtack) glyph, used as both the pin action and the pinned marker. */
const pinGlyph = () => icon(paths('M9 4.5h6', 'M10.2 4.5 8.8 12h6.4L13.8 4.5', 'M12 12v7.5'))

/** Trash can glyph. */
const trashGlyph = () =>
  icon(paths('M4 6.5h16', 'M9 6.5V4.5h6v2', 'M6.5 6.5 8 20h8l1.5-13.5', 'M10 10.5v5.5M14 10.5v5.5'))

/** Ruled-lines glyph: three horizontal rules. */
const ruledLinesGlyph = () => icon(paths('M4 7h16', 'M4 12h16', 'M4 17h16'))

/**
 * Button with the accessible label wiring applied once.
 * @param baseClass - variant class (`qn-icon-button` or `qn-note-action`).
 * @param options - label plus the regular button attributes and children.
 * @returns the button element.
 */
function button(baseClass, { label, className, pressed, children, ...rest }) {
  return h(
    'button',
    {
      type: 'button',
      className: cx(baseClass, className),
      title: label,
      'aria-label': label,
      'aria-pressed': pressed,
      ...rest,
    },
    children,
  )
}

/** Icon-only footer / header button. */
const iconButton = (options) => button('qn-icon-button', options)

/** Small per-row action button (pin / delete). */
const rowAction = (options) => button('qn-note-action', options)

/**
 * Clamp an index into one contiguous group of the display order.
 * @param index - requested index.
 * @param groupStart - first display index of the group.
 * @param groupSize - number of rows in the group (at least one).
 * @returns the clamped display index.
 */
export function clampIndexWithinGroup(index, groupStart, groupSize) {
  const start = Math.max(0, Math.round(groupStart) || 0)
  const size = Math.max(1, Math.round(groupSize) || 1)
  const wanted = Number.isFinite(index) ? Math.round(index) : start
  return Math.min(start + size - 1, Math.max(start, wanted))
}

/**
 * Whether pointer movement is far enough to begin a drag.
 * @param dx - horizontal movement since pointerdown, in CSS pixels.
 * @param dy - vertical movement since pointerdown, in CSS pixels.
 * @returns whether the drag threshold is crossed.
 */
export function exceedsDragThreshold(dx, dy) {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX
}

/**
 * Target display index for a dragged row.
 *
 * Only rows of the same pinned group take part, so a note can never be dropped
 * into the other group: dragging past the last row of a group clamps to the
 * group edge (the store clamps again before persisting).
 *
 * @param rows - measured rows in display order: `{ id, top, height, pinned }`.
 * @param pointerY - pointer position in viewport coordinates.
 * @param draggedId - id of the row being dragged.
 * @returns the target display index.
 */
export function computeDropIndex(rows, pointerY, draggedId) {
  const dragged = rows.find((row) => row.id === draggedId)
  if (dragged === undefined) return 0
  const group = rows.filter((row) => row.pinned === dragged.pinned)
  const groupStart = rows.indexOf(group[0])
  let offset = 0
  for (const row of group) {
    if (row.id === draggedId) continue
    if (pointerY > row.top + row.height / 2) offset += 1
  }
  return clampIndexWithinGroup(groupStart + offset, groupStart, group.length)
}

/**
 * Vertical preview offset for a row while another row is dragged over it.
 * @param index - display index of the row.
 * @param fromIndex - original display index of the dragged row.
 * @param toIndex - target display index.
 * @param step - row pitch (row height plus gap), in CSS pixels.
 * @returns the offset to apply, in CSS pixels.
 */
export function computeRowShift(index, fromIndex, toIndex, step) {
  if (index === fromIndex || fromIndex === toIndex) return 0
  if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return -step
  if (toIndex < fromIndex && index >= toIndex && index < fromIndex) return step
  return 0
}

/**
 * Whether the user asked the platform to reduce motion.
 * @returns true when animations should be skipped.
 */
function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Inline editor shared by the new-note draft row and the rename row.
 *
 * One editing target at a time (`{ kind, id, value }`). Opening focuses the
 * input (renaming also selects the title), Enter commits, Escape cancels and
 * blur commits only when the field is not blank.
 *
 * @param onCommit - called with `(kind, id, value)` when a commit is requested.
 * @returns editing state, input ref and event helpers.
 */
function useInlineEdit(onCommit) {
  const [editing, setEditing] = React.useState(null)
  const inputRef = React.useRef(null)
  const activeRef = React.useRef(null)

  React.useEffect(() => {
    if (editing === null) return
    inputRef.current?.focus()
    if (editing.kind === 'rename') inputRef.current?.select()
  }, [editing?.id, editing?.kind])

  const begin = (kind, id, value) => {
    activeRef.current = { kind, id, value }
    setEditing({ kind, id, value })
  }

  const change = (value) => {
    if (activeRef.current === null) return
    activeRef.current = { ...activeRef.current, value }
    setEditing((current) => (current === null ? null : { ...current, value }))
  }

  const finish = (commit) => {
    const active = activeRef.current
    if (active === null) return
    activeRef.current = null
    setEditing(null)
    if (commit) onCommit(active.kind, active.id, active.value)
  }

  const onKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return
    event.preventDefault()
    finish(event.key === 'Enter')
  }

  const onBlur = () => {
    const active = activeRef.current
    if (active === null) return
    finish(active.value.trim() !== '')
  }

  return { editing, inputRef, begin, change, finish, onKeyDown, onBlur }
}

/**
 * Render the directory column.
 * @param props - `t`, `state`, `actions`.
 * @returns the sidebar element.
 */
export function Sidebar({ t, state, actions }) {
  const inline = useInlineEdit((kind, id, value) => {
    const title = normalizeTitle(value, t('note.untitled'))
    if (kind === 'draft') {
      const created = actions.createNote(title)
      if (typeof created === 'string') actions.selectNote(created)
      return
    }
    const current = findNote(state, id)
    if (current === undefined || current.title !== title) actions.renameNote(id, title)
  })
  const listRef = React.useRef(null)
  const rowRefs = React.useRef(new Map())
  const dragRef = React.useRef(null)
  const pendingDragRef = React.useRef(null)
  const suppressClickRef = React.useRef(false)
  const flipRef = React.useRef(null)
  const frameRef = React.useRef(null)
  const timersRef = React.useRef(new Set())

  React.useEffect(() => {
    const timers = timersRef.current
    return () => {
      if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      rowRefs.current.clear()
    }
  }, [])

  const notes = sortNotes(state.notes)
  const activeId = state.activeId
  const trashCount = state.trash.length
  const ruledLines = state.settings?.ruledLines === true

  // --------------------------------------------------------------- drag & drop
  /** Drop every inline drag style so React renders the plain list again. */
  const clearDragStyles = () => {
    for (const element of rowRefs.current.values()) {
      element.style.transform = ''
      element.style.transition = ''
      element.removeAttribute('data-dragging')
    }
    if (listRef.current !== null) delete listRef.current.dataset.dragging
  }

  /**
   * FLIP-settle the rows after a reorder: replay the gap between the measured
   * start positions and the new layout, then transition the offsets to zero.
   * @param beforeTops - row id to viewport top measured before the reorder.
   */
  const applyFlip = (beforeTops) => {
    if (prefersReducedMotion()) {
      clearDragStyles()
      return
    }
    const animated = []
    for (const [id, element] of rowRefs.current) {
      const before = beforeTops.get(id)
      if (before === undefined) continue
      const delta = before - element.getBoundingClientRect().top
      if (Math.abs(delta) < 0.5) continue
      element.style.transition = 'none'
      element.style.transform = `translateY(${delta}px)`
      animated.push(element)
    }
    if (animated.length === 0) return
    if (listRef.current !== null) void listRef.current.offsetHeight
    if (typeof requestAnimationFrame !== 'function') {
      clearDragStyles()
      return
    }
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      for (const element of animated) {
        element.style.transition = `transform ${DRAG_ANIMATION_MS}ms ease`
        element.style.transform = ''
      }
    })
  }

  React.useLayoutEffect(() => {
    const pendingFlip = flipRef.current
    if (pendingFlip === null) return
    flipRef.current = null
    applyFlip(pendingFlip)
  })

  /**
   * Finish a drag: measure, reset the preview, then either animate the dropped
   * row into its new slot or let it snap back.
   * @param drag - active drag state.
   * @param cancelled - true for pointercancel; no reorder and no click swallow.
   */
  const finishDrag = (drag, cancelled) => {
    if (dragRef.current !== drag) return
    dragRef.current = null
    pendingDragRef.current = null
    const beforeTops = new Map()
    for (const [id, element] of rowRefs.current) {
      beforeTops.set(id, element.getBoundingClientRect().top)
    }
    const captureElement = drag.element
    try {
      if (
        typeof captureElement.releasePointerCapture === 'function' &&
        (typeof captureElement.hasPointerCapture !== 'function' ||
          captureElement.hasPointerCapture(drag.pointerId))
      ) {
        captureElement.releasePointerCapture(drag.pointerId)
      }
    } catch {
      /* pointer capture is best effort */
    }
    clearDragStyles()
    if (cancelled) {
      applyFlip(beforeTops)
      return
    }
    // The click that follows pointerup belongs to the drag, not to selection.
    suppressClickRef.current = true
    // Release the guard right after that click was delivered, so a later
    // keyboard activation is never swallowed.
    const releaseTimer = setTimeout(() => {
      timersRef.current.delete(releaseTimer)
      suppressClickRef.current = false
    }, 0)
    timersRef.current.add(releaseTimer)
    if (drag.toIndex === drag.fromIndex) {
      applyFlip(beforeTops)
      return
    }
    flipRef.current = beforeTops
    actions.moveNote(drag.id, drag.toIndex)
    // Safety net: if the store refuses the move (same slot after clamping) the
    // reactive render never happens, so settle from here instead.
    const timer = setTimeout(() => {
      timersRef.current.delete(timer)
      if (flipRef.current !== beforeTops) return
      flipRef.current = null
      applyFlip(beforeTops)
    }, 0)
    timersRef.current.add(timer)
  }

  /**
   * Turn a pressed row into a drag once the threshold is crossed.
   * @param pending - pointerdown bookkeeping for the pressed row.
   */
  const beginDrag = (pending) => {
    const list = listRef.current
    if (list === null) return
    const rows = []
    for (const note of notes) {
      const element = rowRefs.current.get(note.id)
      if (element === undefined) continue
      const rect = element.getBoundingClientRect()
      rows.push({
        id: note.id,
        top: rect.top,
        height: rect.height,
        pinned: note.pinned === true,
        el: element,
      })
    }
    const fromIndex = rows.findIndex((row) => row.id === pending.id)
    const pitch = rows.length > 1 ? rows[1].top - rows[0].top : 0
    if (fromIndex < 0 || rows.length < 2 || !(pitch > 0)) {
      pendingDragRef.current = null
      return
    }
    const listRect = list.getBoundingClientRect()
    const dragged = rows[fromIndex]
    dragRef.current = {
      id: pending.id,
      pointerId: pending.pointerId,
      startY: pending.startY,
      fromIndex,
      toIndex: fromIndex,
      rows,
      pitch,
      el: dragged.el,
      element: pending.element,
      listTop: listRect.top,
      listBottom: listRect.bottom,
      listHeight: listRect.height,
      rowTop: dragged.top,
      rowBottom: dragged.top + dragged.height,
    }
    pendingDragRef.current = null
    dragged.el.setAttribute('data-dragging', 'true')
    dragged.el.style.transition = 'none'
    list.dataset.dragging = 'true'
    if (typeof pending.element.setPointerCapture === 'function') {
      try {
        pending.element.setPointerCapture(pending.pointerId)
      } catch {
        /* pointer capture is best effort */
      }
    }
  }

  /**
   * Move the dragged row and its preview gap with the pointer.
   * @param event - pointermove event.
   */
  const updateDrag = (event) => {
    const drag = dragRef.current
    if (drag === null || (event.pointerId ?? drag.pointerId) !== drag.pointerId) return
    const rawShift = event.clientY - drag.startY
    const shift =
      drag.listHeight > 0
        ? clamp(rawShift, drag.listTop - drag.rowTop, drag.listBottom - drag.rowBottom)
        : rawShift
    drag.el.style.transform = shift === 0 ? '' : `translateY(${shift}px)`
    const target = computeDropIndex(drag.rows, event.clientY, drag.id)
    if (target === drag.toIndex) return
    drag.toIndex = target
    // Slide the other rows towards the gap the dragged row would leave.
    drag.rows.forEach((row, index) => {
      if (index === drag.fromIndex) return
      const offset = computeRowShift(index, drag.fromIndex, target, drag.pitch)
      row.el.style.transform = offset === 0 ? '' : `translateY(${offset}px)`
    })
  }

  /**
   * Remember a possible drag. The drag itself starts on the first move that
   * crosses the threshold, so plain clicks / double-clicks stay untouched.
   * @param event - pointerdown event.
   * @param note - row the pointer went down on.
   */
  const onRowPointerDown = (event, note) => {
    suppressClickRef.current = false
    pendingDragRef.current = null
    if (event.button !== 0 || inline.editing?.kind === 'rename' || dragRef.current !== null) return
    const target = event.target
    if (
      typeof target?.closest === 'function' &&
      target.closest('.qn-note-action, input, textarea, a') !== null
    ) {
      return
    }
    pendingDragRef.current = {
      id: note.id,
      pointerId: event.pointerId ?? 1,
      startX: event.clientX,
      startY: event.clientY,
      element: event.currentTarget,
    }
  }

  /**
   * Advance the pending/active drag with the pointer.
   * @param event - pointermove event.
   */
  const onListPointerMove = (event) => {
    const drag = dragRef.current
    if (drag !== null) {
      if ((event.pointerId ?? drag.pointerId) === drag.pointerId) updateDrag(event)
      return
    }
    const pending = pendingDragRef.current
    if (pending === null || (event.pointerId ?? pending.pointerId) !== pending.pointerId) return
    if (!exceedsDragThreshold(event.clientX - pending.startX, event.clientY - pending.startY)) {
      return
    }
    beginDrag(pending)
    // Apply the offset on the very same move so a fast drag responds at once.
    if (dragRef.current !== null) updateDrag(event)
  }

  /**
   * Commit or cancel the current gesture.
   * @param event - pointerup / pointercancel event.
   */
  const onListPointerUp = (event) => {
    const drag = dragRef.current
    if (drag !== null && (event.pointerId ?? drag.pointerId) === drag.pointerId) {
      finishDrag(drag, event.type === 'pointercancel')
      return
    }
    pendingDragRef.current = null
  }

  /**
   * Ref callback that keeps the row elements addressable during a drag.
   * @param id - note id.
   * @returns the ref callback.
   */
  const rowRef = (id) => (element) => {
    if (element === null) rowRefs.current.delete(id)
    else rowRefs.current.set(id, element)
  }

  const onSelect = (id) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    actions.selectNote(id)
  }

  /**
   * Keyboard behaviour of a focused row: Alt+Up/Down reorders the note one slot
   * inside its own pinned/unpinned group (the pointer-drag equivalent), F2
   * opens the rename input.
   * @param event - keydown event.
   * @param note - row note.
   */
  const onRowKeyDown = (event, note) => {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      const index = notes.findIndex((item) => item.id === note.id)
      if (index < 0) return
      const group = notes.filter((item) => item.pinned === note.pinned)
      const delta = event.key === 'ArrowUp' ? -1 : 1
      const target = clampIndexWithinGroup(index + delta, notes.indexOf(group[0]), group.length)
      if (target !== index) actions.moveNote(note.id, target)
      return
    }
    if (event.key !== 'F2') return
    event.preventDefault()
    inline.begin('rename', note.id, note.title)
  }

  const openDraft = () => {
    if (inline.editing?.kind === 'draft') {
      inline.inputRef.current?.focus()
      return
    }
    inline.begin('draft', 'draft', '')
  }

  const onDelete = (id) => {
    actions.trashNote(id)
    if (activeId !== id) return
    const remaining = notes.filter((note) => note.id !== id)
    actions.selectNote(remaining.length > 0 ? remaining[0].id : null)
  }

  /**
   * Shared input element for the draft and rename rows.
   * @param options - row id, editor kind, labels and optional data hook.
   * @returns the input element.
   */
  const inlineInput = ({ id, kind, placeholder, ariaLabel, dataHook }) =>
    h('input', {
      key: kind,
      ref: inline.inputRef,
      className: 'qn-note-input',
      type: 'text',
      value: inline.editing?.value ?? '',
      maxLength: MAX_TITLE_LENGTH,
      placeholder,
      'aria-label': ariaLabel,
      ...(dataHook === null ? {} : { [dataHook]: id }),
      onChange: (event) => inline.change(event.target.value),
      onKeyDown: inline.onKeyDown,
      onBlur: inline.onBlur,
    })

  const renderRow = (note) => {
    const active = note.id === activeId
    const renaming =
      inline.editing !== null && inline.editing.kind === 'rename' && inline.editing.id === note.id
    const pinned = note.pinned === true
    const pinLabel = pinned ? t('sidebar.unpin') : t('sidebar.pin')
    return h(
      'li',
      {
        key: note.id,
        ref: rowRef(note.id),
        className: 'qn-note-row',
        'data-active': active ? 'true' : 'false',
        'data-qn-note-id': note.id,
        onPointerDown: (event) => onRowPointerDown(event, note),
      },
      renaming
        ? inlineInput({
            id: note.id,
            kind: 'rename',
            ariaLabel: t('sidebar.rename'),
            dataHook: 'data-qn-rename',
          })
        : h(
            'button',
            {
              key: 'select',
              type: 'button',
              className: 'qn-note-select',
              title: `${note.title} — ${t('sidebar.renameHint')}`,
              'aria-current': active ? 'true' : undefined,
              'data-qn-select': note.id,
              onClick: () => onSelect(note.id),
              onDoubleClick: () => inline.begin('rename', note.id, note.title),
              onKeyDown: (event) => onRowKeyDown(event, note),
            },
            pinned &&
              h(
                'span',
                {
                  className: 'qn-note-pin',
                  role: 'img',
                  title: t('sidebar.pinMark'),
                  'aria-label': t('sidebar.pinMark'),
                },
                pinGlyph(),
              ),
            h('span', { className: 'qn-note-title' }, note.title),
          ),
      h(
        'span',
        { className: 'qn-note-actions' },
        rowAction({
          label: pinLabel,
          pressed: pinned,
          'data-qn-pin': note.id,
          onClick: () => actions.togglePin(note.id),
          children: pinGlyph(),
        }),
        rowAction({
          label: t('sidebar.delete'),
          className: 'qn-note-action-danger',
          'data-qn-delete': note.id,
          onClick: () => onDelete(note.id),
          children: trashGlyph(),
        }),
      ),
    )
  }

  const draftRow = h(
    'li',
    { key: 'draft', className: 'qn-note-row', 'data-qn-draft': 'true' },
    inlineInput({
      id: 'draft',
      kind: 'draft',
      placeholder: t('sidebar.newPlaceholder'),
      ariaLabel: t('sidebar.newNote'),
      dataHook: null,
    }),
  )

  const showEmpty = notes.length === 0 && inline.editing === null
  const listChildren =
    inline.editing?.kind === 'draft' ? [draftRow, ...notes.map(renderRow)] : notes.map(renderRow)

  const head = h(
    'div',
    { className: 'qn-sidebar-head' },
    h('span', { className: 'qn-sidebar-title' }, t('sidebar.title')),
    iconButton({
      label: t('sidebar.newNote'),
      'data-qn-new': 'true',
      onMouseDown: (event) => {
        if (inline.editing?.kind === 'draft') event.preventDefault()
      },
      onClick: openDraft,
      children: plusGlyph(),
    }),
  )

  let body
  if (state.view === 'settings') {
    body = h(SettingsPanel, { t, state, actions })
  } else if (state.view === 'trash') {
    body = h(TrashPanel, { t, state, actions })
  } else {
    body = h(
      'div',
      { className: 'qn-notes-view' },
      head,
      showEmpty
        ? h(
            'div',
            { className: 'qn-note-empty' },
            h('p', { className: 'qn-note-empty-text' }, t('sidebar.empty')),
            textButton({ label: t('sidebar.emptyAction'), onClick: openDraft }),
          )
        : h(
            'ul',
            {
              ref: listRef,
              className: 'qn-note-list',
              'data-qn-note-list': 'true',
              onPointerMove: onListPointerMove,
              onPointerUp: onListPointerUp,
              onPointerCancel: onListPointerUp,
            },
            listChildren,
          ),
    )
  }

  const phase = state.sync?.phase ?? 'local'
  const syncText = t(syncLabelKey(phase))
  const trashLabel =
    trashCount > 0 ? t('sidebar.trashWithCount', { n: trashCount }) : t('sidebar.trash')

  return h(
    'aside',
    {
      className: 'qn-sidebar',
      style: { width: `${state.ui.sidebarWidth}px` },
      'data-qn-sidebar': 'true',
      'data-view': state.view,
    },
    body,
    h(
      'footer',
      { className: 'qn-sidebar-footer' },
      iconButton({
        label: t('sidebar.settings'),
        pressed: state.view === 'settings',
        'data-qn-settings': 'true',
        onClick: () => actions.setView(state.view === 'settings' ? 'notes' : 'settings'),
        children: settingsGlyph(),
      }),
      iconButton({
        label: trashLabel,
        className: 'qn-trash-button',
        pressed: state.view === 'trash',
        'data-qn-trash': 'true',
        onClick: () => actions.setView(state.view === 'trash' ? 'notes' : 'trash'),
        children: [
          trashGlyph(),
          trashCount > 0 &&
            h('span', { key: 'badge', className: 'qn-badge' }, formatCount(trashCount)),
        ],
      }),
      iconButton({
        label: t('sidebar.ruledLines'),
        pressed: ruledLines,
        'data-qn-ruled-lines': 'true',
        onClick: () => actions.updateSettings({ ruledLines: !ruledLines }),
        children: ruledLinesGlyph(),
      }),
      h('span', { className: 'qn-sidebar-spacer' }),
      h('span', {
        className: 'qn-sync-dot',
        role: 'status',
        'data-phase': phase,
        'data-qn-sync': phase,
        title: syncText,
        'aria-label': syncText,
      }),
    ),
  )
}
