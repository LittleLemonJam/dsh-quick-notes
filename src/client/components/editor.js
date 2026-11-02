/**
 * Note editor: contentEditable surface, meta header, context menu wiring.
 *
 * The editor is intentionally **uncontrolled**: React never renders the note
 * body as children. The active note's HTML is written to `innerHTML` only when
 * the active note id changes (or when the store replaces the whole state), and
 * every `input` reports `el.innerHTML` back through
 * `actions.setNoteHtml(note.id, html)`. Writing during typing would reset the
 * caret and drop IME composition, so it is never done.
 *
 * Paste and drop are intercepted: image files are decoded/scaled/re-encoded by
 * `images.readImageFile` and inserted as bounded `data:` images, `text/html`
 * goes through the shared whitelist and is inserted with
 * `format.insertHtmlAtCaret`, plain text through `format.insertPlainText`.
 * Ctrl/Cmd+B/I/U run through `format.js`. A non-empty selection opens the custom
 * format menu on right click; the selection range is saved and restored before
 * any menu command runs.
 *
 * The header title is read-only until it is double-clicked, then it becomes an
 * inline input (Enter commits, Escape cancels, blur commits). `settings.ruledLines`
 * switches the body to lined-paper mode via the `qn-editor-ruled` class and the
 * `--qn-line-height` custom property consumed by the CSS gradient.
 */
import React from 'react'
import { cx, h } from '../dom.js'
import { normalizeTitle } from '../../shared/model.js'
import { MAX_NOTE_HTML_LENGTH } from '../../shared/constants.js'
import { sanitizeHtml } from '../../shared/sanitize.js'
import { isImageFile, readImageFile } from '../images.js'
import { ContextMenu } from './context-menu.js'
import {
  getEditorRange,
  insertHtmlAtCaret,
  insertPlainText,
  toggleBold,
  toggleItalic,
  toggleUnderline,
} from './format.js'

/** Ctrl/Cmd shortcuts for the inline toggles, keyed by lower-case letter. */
const FORMAT_SHORTCUTS = new Map([
  ['b', toggleBold],
  ['i', toggleItalic],
  ['u', toggleUnderline],
])

/** Localized copy. */
export const I18N = {
  en: {
    'editor.empty': 'Select a note or create one.',
    'editor.emptyHint': 'Use the + button in the directory to add a note.',
    'editor.words': '{n} characters',
    'editor.updated': 'Edited {time}',
    'editor.ariaLabel': 'Note body',
    'editor.titleLabel': 'Note title',
    'editor.renameTitle': 'Double-click to rename',
    'editor.titleInput': 'Note title',
  },
  zh: {
    'editor.empty': '选择一条便签，或新建一条。',
    'editor.emptyHint': '用左侧目录的 + 按钮新建一条。',
    'editor.words': '{n} 字',
    'editor.updated': '更新于 {time}',
    'editor.ariaLabel': '便签正文',
    'editor.titleLabel': '便签标题',
    'editor.renameTitle': '双击重命名',
    'editor.titleInput': '便签标题',
  },
}

/** Component styles. */
export const CSS = `
.qn-main {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--qn-paper-bg, var(--dsw-alias-bg-base));
}

.qn-main-empty {
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.qn-editor-empty {
  max-width: 260px;
  text-align: center;
  color: var(--dsw-alias-label-secondary);
}

.qn-editor-empty-title {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.qn-editor-empty-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}

.qn-editor-head {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 10px 16px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}

.qn-editor-title {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  cursor: text;
}

.qn-editor-title-input {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding: 1px 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  outline: none;
}

.qn-editor-title-input:focus {
  border-color: var(--dsw-alias-brand-primary);
}

.qn-editor-meta {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.qn-editor-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px 28px;
}

.qn-editor-body {
  min-height: 100%;
  outline: none;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-primary);
  caret-color: var(--dsw-alias-brand-primary);
}

.qn-editor-ruled {
  background-image: repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent calc(var(--qn-line-height, 1.75em) - 1px),
    var(--qn-rule-color, var(--dsw-alias-border-l1)) calc(var(--qn-line-height, 1.75em) - 1px),
    var(--qn-rule-color, var(--dsw-alias-border-l1)) var(--qn-line-height, 1.75em)
  );
}

/* Content blocks share the body line box so the ruled lines stay aligned with
   the text (pasted paragraphs must not add their own vertical margins). */
.qn-editor-body p,
.qn-editor-body div,
.qn-editor-body blockquote,
.qn-editor-body ul,
.qn-editor-body ol,
.qn-editor-body pre {
  margin-top: 0;
  margin-bottom: 0;
}

/* Pasted pictures are re-encoded to at most 1024px, but the window can be much
   narrower: clamp to the editor width so a wide screenshot can never push the
   scroll container sideways. */
.qn-editor-body img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 6px 0;
  border-radius: 6px;
}
`

/** Editor preferences fallback when settings are missing (matches model.js). */
const DEFAULT_FONT_SIZE = 15
const DEFAULT_LINE_HEIGHT = 1.75

/** Width of the scrollbar gutter kept free when focusing from blank space. */
const SCROLLBAR_GUTTER = 18

/**
 * Interpolate `{name}` placeholders in a translated string.
 *
 * The host injects `t(key, params?)`; passing no params and filling the
 * placeholders here keeps the copy correct regardless of whether the host
 * implements interpolation itself.
 *
 * @param t - translation function from the slot props.
 * @param key - dictionary key.
 * @param params - placeholder values.
 * @returns the final text.
 */
function translate(t, key, params) {
  const text = t(key, params)
  if (typeof text !== 'string') return ''
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    params !== undefined && params[name] !== undefined ? String(params[name]) : match,
  )
}

/**
 * Count non-whitespace characters of a note's rendered text.
 * @param text - rendered text content.
 * @returns character count without whitespace.
 */
function countCharacters(text) {
  return String(text ?? '').replace(/\s+/g, '').length
}

/**
 * Format an `updatedAt` timestamp for the header.
 * @param timestamp - epoch milliseconds.
 * @param now - current time, injectable for tests.
 * @returns `HH:MM` for today, `YYYY-MM-DD HH:MM` otherwise, or '' when invalid.
 */
function formatUpdatedAt(timestamp, now = Date.now()) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return ''
  const date = new Date(timestamp)
  const current = new Date(now)
  const pad = (value) => String(value).padStart(2, '0')
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const sameDay =
    date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate()
  if (sameDay) return clock
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`
}

/**
 * Rough number of characters `<img src="…">` adds around the data URL.
 * Used to keep an inserted picture inside the persisted note size cap.
 */
const IMAGE_HTML_OVERHEAD = 24

/**
 * Collect image files from a `FileList`-like object (clipboard/drag data).
 * Non-image entries are skipped; anything that is not iterable yields an empty
 * list, so a legacy browser without `files` support keeps the text path.
 *
 * @param list - `FileList` or array of files.
 * @returns the image files, in their original order.
 */
function imageFilesOf(list) {
  if (list === null || list === undefined) return []
  try {
    return Array.from(list).filter((file) => isImageFile(file))
  } catch {
    return []
  }
}

/**
 * Collect image files from a `DataTransferItemList` (clipboard items / drop
 * items). Some browsers expose a copied image only through `items`, not through
 * `files`, so the paste path checks both.
 *
 * @param items - `DataTransferItemList` or array of items.
 * @returns the image files, in their original order.
 */
function imageFilesFromItems(items) {
  if (items === null || items === undefined) return []
  try {
    return Array.from(items)
      .filter(
        (item) =>
          item?.kind === 'file' && typeof item.type === 'string' && item.type.startsWith('image/'),
      )
      .map((item) => item.getAsFile?.())
      .filter((file) => file !== null && file !== undefined && isImageFile(file))
  } catch {
    return []
  }
}

/**
 * Resolve the image files carried by a clipboard/drag payload, preferring
 * `files` over `items`.
 *
 * @param data - clipboard or data-transfer payload.
 * @returns the image files to ingest.
 */
function imageFilesFrom(data) {
  const direct = imageFilesOf(data?.files)
  return direct.length > 0 ? direct : imageFilesFromItems(data?.items)
}

/**
 * Insert sanitised rich text, or plain text when the rich text was empty.
 * @param editor - contentEditable element.
 * @param cleanHtml - already sanitised HTML ('' when absent or unusable).
 * @param text - plain-text fallback.
 */
function insertClipboardContent(editor, cleanHtml, text) {
  if (cleanHtml !== '') {
    insertHtmlAtCaret(editor, cleanHtml)
    return
  }
  if (text !== '') insertPlainText(editor, text)
}

/**
 * Render the editor for the active note.
 * @param props - `t`, `state`, `actions`, `note`.
 * @returns the editor element.
 */
export function NoteEditor({ t, state, actions, note }) {
  const bodyRef = React.useRef(null)
  const savedRangeRef = React.useRef(null)
  const titleEditingRef = React.useRef(false)
  const titleInputRef = React.useRef(null)
  const [menu, setMenu] = React.useState(null)
  const [charCount, setCharCount] = React.useState(0)
  const [titleDraft, setTitleDraft] = React.useState(null)
  const noteId = note?.id ?? null
  const contentEpoch = state?.contentEpoch ?? 0
  const titleEditing = titleDraft !== null

  // Load the note into the contentEditable when the active note changes, and
  // also when the store replaced the whole state (newer Host copy, JSON
  // import) even though the id stayed the same. `note` is read here on purpose:
  // typing produces a new note object every keystroke and must never rewrite
  // the DOM under the caret, so the dependency list stays on id + epoch.
  // Layout timing avoids a flash of the previous note.
  React.useLayoutEffect(() => {
    const editor = bodyRef.current
    if (editor === null) return
    editor.innerHTML = note === null ? '' : sanitizeHtml(note.html)
    savedRangeRef.current = null
    titleEditingRef.current = false
    setMenu(null)
    setTitleDraft(null)
    setCharCount(countCharacters(editor.textContent))
  }, [noteId, contentEpoch])

  // Focus and select the title draft as soon as the inline editor appears.
  React.useLayoutEffect(() => {
    if (!titleEditing) return
    const input = titleInputRef.current
    if (input === null) return
    input.focus()
    input.select()
  }, [titleEditing])

  const closeMenu = React.useCallback(() => {
    savedRangeRef.current = null
    setMenu(null)
  }, [])

  /**
   * Put the saved range back before a menu command runs.
   */
  const restoreSelection = React.useCallback(() => {
    const editor = bodyRef.current
    const range = savedRangeRef.current
    if (editor === null || range === null) return
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return
    const document = editor.ownerDocument
    const selection = document.getSelection()
    if (selection === null) return
    // Focus first: focusing a contentEditable can move the caret, so the saved
    // range must be restored afterwards.
    editor.focus()
    selection.removeAllRanges()
    selection.addRange(range)
  }, [])

  /**
   * Report the current HTML to the store and refresh the character count.
   * @param event - React input event on the contentEditable.
   */
  const handleInput = (event) => {
    const editor = event.currentTarget
    setCharCount(countCharacters(editor.textContent))
    actions.setNoteHtml(note.id, editor.innerHTML)
  }

  /**
   * Switch the header title into its inline rename input.
   */
  const beginTitleEdit = () => {
    titleEditingRef.current = true
    setTitleDraft(note.title)
  }

  /**
   * Leave the inline rename input.
   * @param submit - whether the draft should be committed; `false` cancels.
   */
  const finishTitleEdit = (submit) => {
    if (!titleEditingRef.current) return
    titleEditingRef.current = false
    const value = titleDraft ?? ''
    setTitleDraft(null)
    if (!submit) return
    const next = normalizeTitle(value, note.title)
    if (next === note.title) return
    if (typeof actions.renameNote === 'function') actions.renameNote(note.id, next)
  }

  /**
   * Track the title draft while typing in the inline rename input.
   * @param event - React change event on the title input.
   */
  const handleTitleChange = (event) => {
    setTitleDraft(event.target.value)
  }

  /**
   * Enter commits the title draft, Escape cancels it.
   * @param event - React keyboard event on the title input.
   */
  const handleTitleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      finishTitleEdit(true)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      finishTitleEdit(false)
    }
  }

  /**
   * Ingest pasted / dropped image files.
   *
   * Each file is decoded, scaled and re-encoded by `readImageFile`; only the
   * bounded data URL is inserted. A file that cannot be processed (unsupported
   * type, no canvas, decode failure) is ignored on purpose — inserting the
   * original bytes would blow the state budget and the layout. Pictures that
   * would push the note over the persistence cap are skipped as well.
   *
   * @param editor - contentEditable element.
   * @param files - image files to ingest.
   */
  const insertImageFiles = async (editor, files) => {
    for (const file of files) {
      const dataUrl = await readImageFile(file)
      if (dataUrl === null) continue
      // Keep the whole note inside the persistence cap: an extra image could
      // otherwise be silently truncated by the store and dropped on reload.
      const projected = editor.innerHTML.length + dataUrl.length + IMAGE_HTML_OVERHEAD
      if (projected > MAX_NOTE_HTML_LENGTH) continue
      insertHtmlAtCaret(editor, `<img src="${dataUrl}">`)
    }
  }

  /**
   * Intercept paste: image files are ingested, rich text is sanitised, plain
   * text is inserted as text.
   * @param event - React paste event on the contentEditable.
   */
  const handlePaste = (event) => {
    const clipboard = event.clipboardData
    if (clipboard === null || clipboard === undefined) return
    const files = imageFilesFrom(clipboard)
    if (files.length > 0) {
      event.preventDefault()
      void insertImageFiles(event.currentTarget, files)
      return
    }
    const html = clipboard.getData('text/html')
    const text = clipboard.getData('text/plain') ?? ''
    const clean = html === '' ? '' : sanitizeHtml(html)
    if (clean === '' && text === '') return
    event.preventDefault()
    insertClipboardContent(event.currentTarget, clean, text)
  }

  /**
   * Intercept drag-and-drop: image files are ingested, dragged HTML is
   * sanitised, dragged text is inserted as text. The browser default insertion
   * would bypass the whitelist.
   * @param event - React drop event on the contentEditable.
   */
  const handleDrop = (event) => {
    const editor = bodyRef.current
    if (editor === null) return
    const transfer = event.dataTransfer
    if (transfer === null || transfer === undefined) return
    const files = imageFilesFrom(transfer)
    const html = transfer.getData('text/html')
    const text = transfer.getData('text/plain') ?? ''
    event.preventDefault()
    const document = editor.ownerDocument
    // Chromium exposes caretRangeFromPoint; fall back to the current caret.
    if (typeof document.caretRangeFromPoint === 'function') {
      const range = document.caretRangeFromPoint(event.clientX, event.clientY)
      if (range !== null && editor.contains(range.startContainer)) {
        const selection = document.getSelection()
        if (selection !== null) {
          selection.removeAllRanges()
          selection.addRange(range)
        }
      }
    }
    editor.focus()
    if (files.length > 0) {
      void insertImageFiles(editor, files)
      return
    }
    insertClipboardContent(editor, html === '' ? '' : sanitizeHtml(html), text)
  }

  /**
   * Keep the browser from navigating when a drag hovers the editor.
   * @param event - React dragover event.
   */
  const handleDragOver = (event) => {
    event.preventDefault()
  }

  /**
   * Ctrl/Cmd+B/I/U formatting.
   * @param event - React keyboard event on the contentEditable.
   */
  const handleKeyDown = (event) => {
    if (event.key === 'Escape' && menu !== null) {
      event.preventDefault()
      closeMenu()
      return
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
    const toggle = FORMAT_SHORTCUTS.get(event.key.toLowerCase())
    if (toggle === undefined) return
    event.preventDefault()
    toggle(event.currentTarget)
  }

  /**
   * Open the format menu when the user right-clicks a non-empty selection.
   * @param event - React contextmenu event on the contentEditable.
   */
  const handleContextMenu = (event) => {
    const editor = bodyRef.current
    if (editor === null) return
    const range = getEditorRange(editor)
    if (range === null || range.collapsed) return
    event.preventDefault()
    savedRangeRef.current = range.cloneRange()
    setMenu({ x: event.clientX, y: event.clientY })
  }

  /**
   * Clicking the empty area under the text focuses the editor at the end.
   * @param event - React mousedown event on the scroll container.
   */
  const handleScrollMouseDown = (event) => {
    if (event.target !== event.currentTarget) return
    const editor = bodyRef.current
    if (editor === null) return
    const scroll = event.currentTarget
    const scrollRect = scroll.getBoundingClientRect()
    const bodyRect = editor.getBoundingClientRect()
    // Only the blank area below the text focuses the editor; leave the
    // scrollbar and the text itself to the browser.
    if (event.clientY <= bodyRect.bottom) return
    if (event.clientX > scrollRect.right - SCROLLBAR_GUTTER) return
    event.preventDefault()
    editor.focus()
    const document = editor.ownerDocument
    const selection = document.getSelection()
    if (selection === null) return
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  if (note === null) {
    return h(
      'main',
      { className: 'qn-main qn-main-empty', 'data-qn-editor': 'empty' },
      h(
        'div',
        { className: 'qn-editor-empty' },
        h('p', { className: 'qn-editor-empty-title' }, t('editor.empty')),
        h('p', { className: 'qn-editor-empty-hint' }, t('editor.emptyHint')),
      ),
    )
  }

  const settings = state?.settings ?? {}
  const fontSize = Number.isFinite(settings.fontSize) ? settings.fontSize : DEFAULT_FONT_SIZE
  const lineHeight = Number.isFinite(settings.lineHeight)
    ? settings.lineHeight
    : DEFAULT_LINE_HEIGHT
  const ruledLines = settings.ruledLines === true
  const bodyStyle = { fontSize: `${fontSize}px`, lineHeight }
  if (ruledLines) bodyStyle['--qn-line-height'] = `${fontSize * lineHeight}px`
  const updated = formatUpdatedAt(note.updatedAt)

  const title = titleEditing
    ? h('input', {
        ref: titleInputRef,
        type: 'text',
        className: 'qn-editor-title-input',
        value: titleDraft ?? '',
        'aria-label': t('editor.titleInput'),
        'data-qn-title-input': 'true',
        spellCheck: false,
        onChange: handleTitleChange,
        onKeyDown: handleTitleKeyDown,
        onBlur: () => finishTitleEdit(true),
      })
    : h(
        'h2',
        {
          className: 'qn-editor-title',
          title: `${note.title}\n${t('editor.renameTitle')}`,
          'aria-label': t('editor.titleLabel'),
          'data-qn-editor-title': 'true',
          onDoubleClick: beginTitleEdit,
        },
        note.title,
      )

  return h(
    'main',
    { className: 'qn-main', 'data-qn-editor': 'note' },
    h(
      'header',
      { className: 'qn-editor-head' },
      title,
      h(
        'div',
        { className: 'qn-editor-meta' },
        h(
          'span',
          { className: 'qn-editor-words', 'data-qn-editor-words': 'true' },
          translate(t, 'editor.words', { n: charCount }),
        ),
        updated === ''
          ? null
          : h(
              'span',
              {
                className: 'qn-editor-updated',
                title: new Date(note.updatedAt).toLocaleString(),
                'data-qn-editor-updated': 'true',
              },
              translate(t, 'editor.updated', { time: updated }),
            ),
      ),
    ),
    h(
      'div',
      { className: 'qn-editor-scroll', onMouseDown: handleScrollMouseDown },
      h('div', {
        ref: bodyRef,
        className: cx('qn-editor-body', ruledLines && 'qn-editor-ruled'),
        contentEditable: true,
        suppressContentEditableWarning: true,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': t('editor.ariaLabel'),
        spellCheck: true,
        'data-qn-editor-body': 'true',
        style: bodyStyle,
        onInput: handleInput,
        onPaste: handlePaste,
        onDrop: handleDrop,
        onDragOver: handleDragOver,
        onKeyDown: handleKeyDown,
        onContextMenu: handleContextMenu,
      }),
    ),
    menu === null
      ? null
      : h(ContextMenu, {
          t,
          x: menu.x,
          y: menu.y,
          editor: bodyRef.current,
          onBeforeAction: restoreSelection,
          onClose: closeMenu,
        }),
  )
}
