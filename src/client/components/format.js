/**
 * Selection formatting and clipboard commands.
 *
 * Used by `editor.js` (keyboard shortcuts, paste/drop insertion) and
 * `context-menu.js` (copy / cut / paste / clear formatting).
 *
 * Three command families live here:
 * - inline toggles: bold, italic and underline (`execCommand` when available,
 *   DOM wrapping/unwrapping as the fallback);
 * - `clearFormat`, which strips inline formatting from the selection;
 * - clipboard and insertion commands (`copySelection`, `cutSelection`,
 *   `pasteAtCaret`, `insertPlainText`, `insertHtmlAtCaret`), which prefer
 *   `document.execCommand` and fall back to Range surgery when it is
 *   unavailable or reports failure (hardened builds, jsdom, future engines).
 *
 * `wrapSelection` wraps inline runs one block at a time, so a selection that
 * spans paragraphs never produces invalid `<b><p>…</p></b>` nesting.
 *
 * Every mutating command reports through `reportMutation`: one `input` event is
 * dispatched on the editor so the store persists the change, and focus/selection
 * are restored so the caret stays where the user expects. The module never
 * touches the network and never reads global state other than the passed
 * editor's document.
 */
import { sanitizeHtml } from '../../shared/sanitize.js'

/** Inline elements that clear-format / toggle commands may unwrap. */
const INLINE_FORMAT_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'del',
  'ins',
  'mark',
  'span',
  'font',
])

/** Tag aliases accepted per inline toggle, as browsers produce them. */
const BOLD_TAGS = ['b', 'strong']
const ITALIC_TAGS = ['i', 'em']
const UNDERLINE_TAGS = ['u']

/**
 * Block-level tags: a wrapper must never contain one of these, otherwise a
 * selection spanning paragraphs would produce `<b><p>…</p></b>`, which is
 * invalid HTML and renders inconsistently.
 */
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
])

/** `NodeFilter.SHOW_ELEMENT` without depending on the global NodeFilter. */
const SHOW_ELEMENT = 1

/** `Node.ELEMENT_NODE` without depending on the global Node object. */
const ELEMENT_NODE = 1

/**
 * Resolve the document that owns an editor element.
 * @param editor - contentEditable element.
 * @returns the document, or null in a non-DOM environment.
 */
function getDocument(editor) {
  return editor?.ownerDocument ?? null
}

/**
 * Resolve the selection object for an editor's document.
 * @param editor - contentEditable element.
 * @returns the selection, or null.
 */
function getSelection(editor) {
  const document = getDocument(editor)
  if (document === null || typeof document.getSelection !== 'function') return null
  return document.getSelection()
}

/**
 * Read the current selection when it is inside the editor.
 * @param editor - contentEditable element.
 * @returns the live range, or null when there is no editor selection.
 */
export function getEditorRange(editor) {
  const selection = getSelection(editor)
  if (selection === null || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  const root = range.commonAncestorContainer
  if (root === null || root === undefined) return null
  return editor.contains(root) ? range : null
}

/**
 * Replace the editor's selection with a range.
 * @param editor - contentEditable element.
 * @param range - range to select.
 */
function setEditorRange(editor, range) {
  const selection = getSelection(editor)
  if (selection === null) return
  selection.removeAllRanges()
  selection.addRange(range)
}

/**
 * Run one `execCommand` call, reporting whether the engine accepted it.
 * @param editor - contentEditable element.
 * @param command - command name.
 * @param value - command value.
 * @returns whether the command succeeded.
 */
function runExec(editor, command, value) {
  const document = getDocument(editor)
  if (document === null || typeof document.execCommand !== 'function') return false
  try {
    return document.execCommand(command, false, value) === true
  } catch {
    return false
  }
}

/**
 * Dispatch one `input` event so the editor's `onInput` reports the new HTML.
 * @param editor - contentEditable element.
 */
function dispatchInput(editor) {
  const View = getDocument(editor)?.defaultView
  const EventCtor = View?.Event ?? (typeof Event === 'function' ? Event : null)
  if (editor === null || EventCtor === null) return
  try {
    editor.dispatchEvent(new EventCtor('input', { bubbles: true }))
  } catch {
    // A dispatch failure must not break the command itself.
  }
}

/**
 * Focus the editor without throwing when the element is detached.
 * @param editor - contentEditable element.
 */
function focusEditor(editor) {
  try {
    editor?.focus?.()
  } catch {
    // Detached or read-only editors simply stay unfocused.
  }
}

/**
 * Common tail of every mutating command: keep the selection on the edited
 * content, focus the editor, then report input.
 *
 * Some engines (and jsdom) move the caret to the start when a contentEditable
 * is focused programmatically, so the range is captured before focusing and
 * restored afterwards.
 *
 * @param editor - contentEditable element.
 */
function afterMutation(editor) {
  const selection = getSelection(editor)
  let saved = null
  if (selection !== null && selection.rangeCount > 0) {
    const current = selection.getRangeAt(0)
    if (editor.contains(current.commonAncestorContainer)) saved = current.cloneRange()
  }
  focusEditor(editor)
  if (saved !== null && selection !== null) {
    selection.removeAllRanges()
    selection.addRange(saved)
  }
  dispatchInput(editor)
}

/**
 * Report a command result: dispatch `input` and restore focus when the DOM
 * changed, and pass the boolean result through unchanged.
 * @param editor - contentEditable element.
 * @param changed - whether the command modified the DOM.
 * @returns the same `changed` flag.
 */
function reportMutation(editor, changed) {
  if (!changed) return false
  afterMutation(editor)
  return true
}

/**
 * Whether a node is a block-level element (as opposed to inline content).
 * @param node - candidate node.
 * @returns whether the node must not be placed inside an inline wrapper.
 */
function isBlockElement(node) {
  if (node === null || node === undefined || node.nodeType !== ELEMENT_NODE) return false
  return BLOCK_TAGS.has(String(node.tagName ?? '').toLowerCase())
}

/**
 * Wrap every contiguous run of inline children of `parent` in one wrapper,
 * recursing into block-level children instead of wrapping them.
 *
 * The recursion keeps the wrapper inline-only: `<p>one</p><p>two</p>` becomes
 * `<p><b>one</b></p><p><b>two</b></p>` instead of the invalid
 * `<b><p>one</p><p>two</p></b>`.
 *
 * @param document - owner document.
 * @param parent - fragment or element whose children are wrapped.
 * @param tagName - wrapper tag.
 */
function wrapInlineRuns(document, parent, tagName) {
  let run = []
  const flush = () => {
    if (run.length === 0) return
    const wrapper = document.createElement(tagName)
    parent.insertBefore(wrapper, run[0])
    for (const node of run) wrapper.appendChild(node)
    run = []
  }
  for (const child of Array.from(parent.childNodes)) {
    if (isBlockElement(child)) {
      flush()
      wrapInlineRuns(document, child, tagName)
    } else {
      run.push(child)
    }
  }
  flush()
}

/**
 * Extract a range, wrap its inline runs and insert the result back. Shared by
 * the single-range and the per-block wrapping paths.
 *
 * @param document - owner document.
 * @param range - range to wrap (clipped to one block on the cross-block path).
 * @param tagName - wrapper tag.
 * @returns the first and last inserted nodes, or null when nothing was wrapped.
 */
function wrapExtractedRange(document, range, tagName) {
  let fragment
  try {
    fragment = range.extractContents()
  } catch {
    return null
  }
  if (fragment === null || (fragment.textContent === '' && fragment.childNodes.length === 0)) {
    return null
  }
  wrapInlineRuns(document, fragment, tagName)
  const nodes = Array.from(fragment.childNodes)
  if (nodes.length === 0) return null
  try {
    range.insertNode(fragment)
  } catch {
    return null
  }
  return { first: nodes[0], last: nodes[nodes.length - 1] }
}

/**
 * Select the content of the inserted wrappers, keeping the boundaries inside
 * them so a following "toggle" command recognises the existing format.
 * @param editor - contentEditable element.
 * @param document - owner document.
 * @param first - first inserted node.
 * @param last - last inserted node.
 */
function selectWrappedContents(editor, document, first, last) {
  const range = document.createRange()
  if (first.nodeType === ELEMENT_NODE) range.setStart(first, 0)
  else range.setStartBefore(first)
  if (last.nodeType === ELEMENT_NODE) range.setEnd(last, last.childNodes.length)
  else range.setEndAfter(last)
  setEditorRange(editor, range)
}

/**
 * Collect the deepest block-level elements the range touches, in document order.
 *
 * A selection spanning two paragraphs touches both paragraphs and their shared
 * parent; only the deepest blocks are returned, because wrapping happens inside
 * each of them.
 *
 * @param editor - contentEditable element.
 * @param range - live selection range.
 * @returns the leaf block elements touched by the range.
 */
function leafBlocksInRange(editor, range) {
  const blocks = collectRangeElements(editor, range).filter((element) => isBlockElement(element))
  return blocks.filter((block) => !blocks.some((other) => other !== block && block.contains(other)))
}

/**
 * Wrap the selected inline content of every touched block, one block at a time.
 *
 * This is the cross-block path: wrapping the whole extracted range in one
 * element would nest paragraphs inside the inline wrapper, which is invalid
 * HTML and renders inconsistently. Each block is wrapped in place instead, so
 * the result is `<p><b>one</b></p><p><b>two</b></p>` and the final selection
 * spans from the first wrapper to the last one.
 *
 * @param editor - contentEditable element.
 * @param document - owner document.
 * @param blocks - leaf block elements touched by the range, in document order.
 * @param startPoint - range start boundary.
 * @param endPoint - range end boundary.
 * @param tagName - wrapper tag.
 * @returns whether the DOM changed.
 */
function wrapBlocks(editor, document, blocks, startPoint, endPoint, tagName) {
  const firstBlock = blocks[0]
  const lastBlock = blocks[blocks.length - 1]
  let first = null
  let last = null
  for (const block of blocks) {
    const clipped = document.createRange()
    clipped.selectNodeContents(block)
    const inside = (point) => point.container === block || block.contains(point.container)
    if (block === firstBlock && inside(startPoint)) {
      try {
        clipped.setStart(startPoint.container, startPoint.offset)
      } catch {
        // Keep the block start.
      }
    }
    if (block === lastBlock && inside(endPoint)) {
      try {
        clipped.setEnd(endPoint.container, endPoint.offset)
      } catch {
        // Keep the block end.
      }
    }
    if (clipped.collapsed) continue
    const wrapped = wrapExtractedRange(document, clipped, tagName)
    if (wrapped === null) continue
    if (first === null) first = wrapped.first
    last = wrapped.last
  }
  if (first === null || last === null) return false
  selectWrappedContents(editor, document, first, last)
  return true
}

/**
 * Wrap the current selection in an inline element.
 *
 * The selection can span several text nodes and inline elements (e.g. part of a
 * paragraph plus a bold word): the extracted inline content is moved into one
 * wrapper per contiguous run, so the whole range ends up with the same style.
 * A selection spanning several block-level elements (paragraphs, list items)
 * wraps the inline content inside each block instead of nesting the block inside
 * the inline wrapper.
 *
 * @param editor - contentEditable element.
 * @param tagName - wrapper tag.
 * @returns whether the DOM changed.
 */
export function wrapSelection(editor, tagName) {
  const range = getEditorRange(editor)
  if (range === null || range.collapsed) return false
  const document = getDocument(editor)
  if (document === null) return false
  const blocks = leafBlocksInRange(editor, range)
  if (blocks.length > 0) {
    const startPoint = { container: range.startContainer, offset: range.startOffset }
    const endPoint = { container: range.endContainer, offset: range.endOffset }
    return wrapBlocks(editor, document, blocks, startPoint, endPoint, tagName)
  }
  const wrapped = wrapExtractedRange(document, range, tagName)
  if (wrapped === null) return false
  selectWrappedContents(editor, document, wrapped.first, wrapped.last)
  return true
}

/**
 * Replace an element with its children.
 * @param element - element to unwrap.
 * @returns whether the element was in a tree and got unwrapped.
 */
function unwrapElement(element) {
  const parent = element.parentNode
  if (parent === null) return false
  while (element.firstChild !== null) parent.insertBefore(element.firstChild, element)
  parent.removeChild(element)
  return true
}

/**
 * Whether an element carries no attributes at all.
 * @param element - candidate element.
 * @returns whether it is bare.
 */
function isBare(element) {
  return element.attributes === undefined || element.attributes.length === 0
}

/**
 * Collect every element intersecting a range, in document order.
 * @param editor - contentEditable element.
 * @param range - live range.
 * @returns elements inside the editor that the range touches.
 */
function collectRangeElements(editor, range) {
  const document = getDocument(editor)
  if (document === null || typeof document.createTreeWalker !== 'function') return []
  const elements = []
  const walker = document.createTreeWalker(editor, SHOW_ELEMENT)
  let node = walker.nextNode()
  while (node !== null) {
    if (node !== editor && typeof range.intersectsNode === 'function') {
      try {
        if (range.intersectsNode(node)) elements.push(node)
      } catch {
        // Invalid range boundary: skip the node.
      }
    }
    node = walker.nextNode()
  }
  return elements
}

/**
 * Find the closest formatting ancestor of a node.
 * @param editor - contentEditable element.
 * @param node - range boundary node.
 * @param tags - lower-case tag names to match.
 * @returns the ancestor element or null.
 */
function findFormattingAncestor(editor, node, tags) {
  let current = node.nodeType === ELEMENT_NODE ? node : node.parentElement
  while (current !== null && current !== editor) {
    const tag = String(current.tagName ?? '').toLowerCase()
    if (tags.includes(tag)) return current
    current = current.parentElement
  }
  return null
}

/**
 * Unwrap a list of elements and keep the selection on the freed content.
 * @param editor - contentEditable element.
 * @param elements - elements to unwrap, in document order.
 * @returns whether the DOM changed.
 */
function unwrapElementsAndReselect(editor, elements) {
  if (elements.length === 0) return false
  const document = getDocument(editor)
  const firstNode = elements[0].firstChild
  const lastNode = elements[elements.length - 1].lastChild
  let changed = false
  for (const element of elements) {
    if (unwrapElement(element)) changed = true
  }
  if (changed && document !== null && firstNode !== null && lastNode !== null) {
    try {
      const next = document.createRange()
      next.setStartBefore(firstNode)
      next.setEndAfter(lastNode)
      setEditorRange(editor, next)
    } catch {
      // Reselection is best effort; the original range may be detached.
    }
  }
  return changed
}

/**
 * Toggle one inline tag around the selection (DOM fallback for the toggles).
 * @param editor - contentEditable element.
 * @param tagName - tag to insert when the selection is not formatted.
 * @param matchTags - existing tags that count as "already formatted".
 * @returns whether the DOM changed.
 */
function toggleInlineTag(editor, tagName, matchTags) {
  const range = getEditorRange(editor)
  if (range === null || range.collapsed) return false
  const existing = findFormattingAncestor(editor, range.startContainer, matchTags)
  if (existing === null) return wrapSelection(editor, tagName)
  const elements = collectRangeElements(editor, range).filter((element) =>
    matchTags.includes(String(element.tagName ?? '').toLowerCase()),
  )
  if (!elements.includes(existing)) elements.push(existing)
  return unwrapElementsAndReselect(editor, elements)
}

/**
 * Run one inline toggle: `execCommand` first, DOM wrapping/unwrapping otherwise.
 * @param editor - contentEditable element.
 * @param execCommand - native command name (`bold`, `italic`, `underline`).
 * @param tagName - wrapper tag used by the DOM fallback.
 * @param matchTags - existing tags that count as "already formatted".
 * @returns whether the DOM changed.
 */
function toggleFormat(editor, execCommand, tagName, matchTags) {
  if (runExec(editor, execCommand)) return reportMutation(editor, true)
  return reportMutation(editor, toggleInlineTag(editor, tagName, matchTags))
}

/**
 * Remove inline formatting from the current selection.
 * @param editor - contentEditable element.
 * @returns whether the DOM changed.
 */
export function clearFormat(editor) {
  if (runExec(editor, 'removeFormat')) return reportMutation(editor, true)
  const range = getEditorRange(editor)
  if (range === null) return false
  let changed = false
  for (const element of collectRangeElements(editor, range)) {
    const tag = String(element.tagName ?? '').toLowerCase()
    if (tag === 'font') {
      if (element.hasAttribute?.('color') === true) {
        element.removeAttribute('color')
        changed = true
      }
      if (isBare(element) && unwrapElement(element)) changed = true
      continue
    }
    if (!INLINE_FORMAT_TAGS.has(tag)) continue
    if (element.getAttribute?.('style') !== null) {
      element.removeAttribute('style')
      changed = true
    }
    if (isBare(element) && unwrapElement(element)) changed = true
  }
  return reportMutation(editor, changed)
}

/**
 * Toggle bold on the current selection.
 * @param editor - contentEditable element.
 * @returns whether the DOM changed.
 */
export function toggleBold(editor) {
  return toggleFormat(editor, 'bold', 'b', BOLD_TAGS)
}

/**
 * Toggle italic on the current selection.
 * @param editor - contentEditable element.
 * @returns whether the DOM changed.
 */
export function toggleItalic(editor) {
  return toggleFormat(editor, 'italic', 'i', ITALIC_TAGS)
}

/**
 * Toggle underline on the current selection.
 * @param editor - contentEditable element.
 * @returns whether the DOM changed.
 */
export function toggleUnderline(editor) {
  return toggleFormat(editor, 'underline', 'u', UNDERLINE_TAGS)
}

/**
 * Resolve the clipboard object exposed by the browser, if any.
 * @returns the Clipboard API object or null.
 */
function defaultClipboard() {
  return globalThis.navigator?.clipboard ?? null
}

/**
 * Write text to a clipboard implementation.
 * @param clipboard - Clipboard-like object.
 * @param text - text to write.
 * @returns whether the write succeeded.
 */
async function writeClipboard(clipboard, text) {
  if (clipboard === null || typeof clipboard.writeText !== 'function') return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Read the first non-empty clipboard item of one MIME type.
 * @param items - `ClipboardItem[]` from `clipboard.read()`.
 * @param type - MIME type to look for.
 * @returns the item text, or an empty string.
 */
async function readClipboardItem(items, type) {
  for (const item of items) {
    const types = Array.isArray(item?.types) ? item.types : []
    if (!types.includes(type) || typeof item?.getType !== 'function') continue
    const blob = await item.getType(type)
    const text = typeof blob?.text === 'function' ? await blob.text() : ''
    if (text !== '') return text
  }
  return ''
}

/**
 * Read one clipboard payload, preferring rich text.
 * @param clipboard - Clipboard-like object.
 * @returns `{ html, text }` or null when nothing readable is available.
 */
async function readClipboardPayload(clipboard) {
  if (clipboard === null) return null
  if (typeof clipboard.read === 'function') {
    try {
      const items = await clipboard.read()
      if (Array.isArray(items)) {
        const html = await readClipboardItem(items, 'text/html')
        if (html !== '') return { html, text: '' }
        const text = await readClipboardItem(items, 'text/plain')
        if (text !== '') return { html: '', text }
      }
    } catch {
      // Permission denied or unsupported payload: try readText below.
    }
  }
  if (typeof clipboard.readText !== 'function') return null
  try {
    const text = await clipboard.readText()
    return text === '' ? null : { html: '', text }
  } catch {
    return null
  }
}

/**
 * Copy the current selection to the clipboard.
 * @param editor - contentEditable element.
 * @param clipboard - Clipboard-like object (injectable for tests).
 * @returns whether the copy succeeded.
 */
export async function copySelection(editor, clipboard = defaultClipboard()) {
  const range = getEditorRange(editor)
  if (range === null || range.collapsed) return false
  if (runExec(editor, 'copy')) {
    focusEditor(editor)
    return true
  }
  const copied = await writeClipboard(clipboard, range.toString())
  if (copied) focusEditor(editor)
  return copied
}

/**
 * Cut the current selection: copy it, then remove it from the editor.
 * @param editor - contentEditable element.
 * @param clipboard - Clipboard-like object (injectable for tests).
 * @returns whether the cut succeeded.
 */
export async function cutSelection(editor, clipboard = defaultClipboard()) {
  const range = getEditorRange(editor)
  if (range === null || range.collapsed) return false
  if (runExec(editor, 'cut')) return reportMutation(editor, true)
  const copied = await writeClipboard(clipboard, range.toString())
  if (!copied) return false
  try {
    range.deleteContents()
    range.collapse(true)
    setEditorRange(editor, range)
  } catch {
    return false
  }
  return reportMutation(editor, true)
}

/**
 * Insert prepared nodes at the caret: `execCommand` first, Range insertion as
 * the fallback. Shared by the plain-text and rich-text insertion commands.
 *
 * @param editor - contentEditable element.
 * @param nodes - nodes to insert in the fallback path.
 * @param execCommand - native command name (`insertText` / `insertHTML`).
 * @param execValue - value passed to `execCommand`.
 * @returns whether the DOM changed.
 */
function insertNodesAtCaret(editor, nodes, execCommand, execValue) {
  const range = getEditorRange(editor)
  const document = getDocument(editor)
  if (range === null || document === null) return false
  focusEditor(editor)
  // Focusing may move the caret in some engines; put the captured range back.
  setEditorRange(editor, range)
  if (runExec(editor, execCommand, execValue)) return reportMutation(editor, true)
  const last = nodes[nodes.length - 1] ?? null
  try {
    range.deleteContents()
    if (nodes.length === 1) {
      range.insertNode(nodes[0])
    } else {
      const fragment = document.createDocumentFragment()
      for (const node of nodes) fragment.appendChild(node)
      range.insertNode(fragment)
    }
    if (last !== null) {
      const next = document.createRange()
      next.setStartAfter(last)
      next.collapse(true)
      setEditorRange(editor, next)
    }
  } catch {
    return false
  }
  return reportMutation(editor, true)
}

/**
 * Insert plain text at the caret, preserving line breaks.
 * @param editor - contentEditable element.
 * @param text - text to insert.
 * @returns whether the DOM changed.
 */
export function insertPlainText(editor, text) {
  if (typeof text !== 'string' || text === '') return false
  const document = getDocument(editor)
  if (document === null) return false
  return insertNodesAtCaret(editor, [document.createTextNode(text)], 'insertText', text)
}

/**
 * Insert sanitised HTML at the caret.
 * @param editor - contentEditable element.
 * @param html - untrusted HTML; cleaned through the shared whitelist first.
 * @returns whether the DOM changed.
 */
export function insertHtmlAtCaret(editor, html) {
  const clean = sanitizeHtml(html)
  if (clean === '') return false
  const document = getDocument(editor)
  if (document === null) return false
  const container = document.createElement('div')
  // `clean` is the output of sanitizeHtml: only whitelisted tags/styles.
  container.innerHTML = clean
  return insertNodesAtCaret(editor, Array.from(container.childNodes), 'insertHTML', clean)
}

/**
 * Paste the clipboard content at the caret.
 *
 * `execCommand('paste')` is disabled in most browsers, so this falls back to
 * the async Clipboard API. The clipboard object is injectable for tests.
 *
 * @param editor - contentEditable element.
 * @param clipboard - Clipboard-like object (injectable for tests).
 * @returns whether the DOM changed.
 */
export async function pasteAtCaret(editor, clipboard = defaultClipboard()) {
  const range = getEditorRange(editor)
  if (range === null) return false
  if (runExec(editor, 'paste')) return reportMutation(editor, true)
  const saved = range.cloneRange()
  const payload = await readClipboardPayload(clipboard)
  if (payload === null) return false
  const usable = editor.contains(saved.startContainer) && editor.contains(saved.endContainer)
  focusEditor(editor)
  if (usable) setEditorRange(editor, saved)
  if (payload.html !== '') return insertHtmlAtCaret(editor, payload.html)
  return insertPlainText(editor, payload.text)
}
