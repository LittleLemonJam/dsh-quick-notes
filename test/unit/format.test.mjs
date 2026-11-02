/**
 * Unit tests for the selection formatting commands
 * (`src/client/components/format.js`).
 *
 * The module now only provides bold / italic / underline toggles, clear
 * formatting, inline wrapping and the clipboard / insertion commands. jsdom has
 * no `document.execCommand`, so every command here exercises the Range-based
 * fallback path; the execCommand branches are covered with stubs.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import {
  clearFormat,
  copySelection,
  cutSelection,
  getEditorRange,
  insertHtmlAtCaret,
  insertPlainText,
  pasteAtCaret,
  toggleBold,
  toggleItalic,
  toggleUnderline,
  wrapSelection,
} from '../../src/client/components/format.js'

/**
 * Build an editor inside a fresh jsdom document.
 * @param html - initial editor markup.
 * @returns the document and the contentEditable element.
 */
function createEditor(html = '') {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="editor" contenteditable="true">${html}</div></body></html>`,
  )
  const document = dom.window.document
  const editor = document.getElementById('editor')
  return { dom, document, editor }
}

/**
 * Select a character range across the editor's text nodes.
 * @param editor - contentEditable element.
 * @param start - start character offset.
 * @param end - end character offset.
 * @returns the live range.
 */
function selectText(editor, start, end) {
  const document = editor.ownerDocument
  const walker = document.createTreeWalker(editor, 4)
  let offset = 0
  let startNode = null
  let startOffset = 0
  let endNode = null
  let endOffset = 0
  let node = walker.nextNode()
  while (node !== null) {
    const length = node.nodeValue.length
    if (startNode === null && start <= offset + length) {
      startNode = node
      startOffset = start - offset
    }
    if (endNode === null && end <= offset + length) {
      endNode = node
      endOffset = end - offset
      break
    }
    offset += length
    node = walker.nextNode()
  }
  assert.notEqual(startNode, null, 'selection start must be inside the editor text')
  assert.notEqual(endNode, null, 'selection end must be inside the editor text')
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  const selection = document.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  return range
}

/**
 * Select the whole editor content.
 * @param editor - contentEditable element.
 * @returns the live range.
 */
function selectAll(editor) {
  const document = editor.ownerDocument
  const range = document.createRange()
  range.selectNodeContents(editor)
  const selection = document.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  return range
}

/**
 * Count the `input` events an editor dispatches.
 * @param editor - contentEditable element.
 * @returns a function that stops listening and returns the count.
 */
function countInputEvents(editor) {
  let count = 0
  const listener = () => {
    count += 1
  }
  editor.addEventListener('input', listener)
  return () => {
    editor.removeEventListener('input', listener)
    return count
  }
}

test('getEditorRange: null without a selection or outside the editor', () => {
  const { document, editor } = createEditor('hello')
  assert.equal(getEditorRange(editor), null)
  const outside = document.createElement('p')
  outside.textContent = 'outside'
  document.body.appendChild(outside)
  const range = document.createRange()
  range.selectNodeContents(outside)
  const selection = document.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  assert.equal(getEditorRange(editor), null)
})

test('toggleBold / toggleItalic / toggleUnderline: wrap and unwrap', () => {
  for (const [command, tag] of [
    [toggleBold, 'b'],
    [toggleItalic, 'i'],
    [toggleUnderline, 'u'],
  ]) {
    const { editor } = createEditor('hello world')
    selectText(editor, 6, 11)
    assert.equal(command(editor), true)
    assert.match(editor.innerHTML, new RegExp(`<${tag}>world</${tag}>`))
    // The command reselects the wrapped text, so toggling again removes it.
    assert.equal(command(editor), true)
    assert.equal(editor.innerHTML, 'hello world')
  }
})

test('toggleBold: wraps each block for a cross-paragraph selection', () => {
  // Regression: extracting the whole range and wrapping it in one element would
  // produce the invalid `<b><p>…</p></b>` nesting.
  const { editor } = createEditor('<p>one</p><p>two</p>')
  selectText(editor, 1, 5)
  assert.equal(toggleBold(editor), true)
  const bold = Array.from(editor.querySelectorAll('b'))
  assert.equal(bold.length, 2)
  assert.deepEqual(
    bold.map((element) => element.textContent),
    ['ne', 'tw'],
  )
  assert.equal(editor.querySelector('b p, b div, b li'), null)
  assert.equal(editor.querySelectorAll('p').length, 2)
  assert.equal(editor.textContent, 'onetwo')
})

test('wrapSelection: wraps the selection in the requested inline tag', () => {
  const { editor } = createEditor('hello world')
  selectText(editor, 6, 11)
  assert.equal(wrapSelection(editor, 'u'), true)
  assert.equal(editor.innerHTML, 'hello <u>world</u>')
  assert.equal(editor.textContent, 'hello world')
})

test('wrapSelection: wraps each block for a cross-paragraph selection', () => {
  const { editor } = createEditor('<p>one</p><p>two</p>')
  selectText(editor, 0, 6)
  assert.equal(wrapSelection(editor, 'u'), true)
  const wraps = Array.from(editor.querySelectorAll('u'))
  assert.equal(wraps.length, 2)
  assert.deepEqual(
    wraps.map((element) => element.textContent),
    ['one', 'two'],
  )
  assert.equal(editor.querySelector('u p, u div'), null)
  assert.equal(editor.textContent, 'onetwo')
})

test('clearFormat: removes inline formatting and keeps the text', () => {
  const { editor } = createEditor(
    '<b><mark style="background-color: rgb(255, 243, 163)">world</mark></b>',
  )
  const stop = countInputEvents(editor)
  selectAll(editor)
  assert.equal(clearFormat(editor), true)
  assert.equal(editor.textContent, 'world')
  assert.doesNotMatch(editor.innerHTML, /<b|<mark|style=/)
  assert.equal(stop(), 1)
})

test('insertPlainText: inserts text (never markup) at the caret', () => {
  const { editor } = createEditor('hello ')
  const stop = countInputEvents(editor)
  selectText(editor, 6, 6)
  assert.equal(insertPlainText(editor, '<b>world</b>'), true)
  assert.equal(editor.textContent, 'hello <b>world</b>')
  assert.doesNotMatch(editor.innerHTML, /<b>/)
  assert.equal(stop(), 1)
})

test('insertPlainText: ignores empty input', () => {
  const { editor } = createEditor('hello')
  selectText(editor, 2, 2)
  assert.equal(insertPlainText(editor, ''), false)
  assert.equal(editor.innerHTML, 'hello')
})

test('insertHtmlAtCaret: sanitises pasted HTML before inserting', () => {
  const { editor } = createEditor('hello ')
  const stop = countInputEvents(editor)
  selectText(editor, 6, 6)
  const inserted = insertHtmlAtCaret(
    editor,
    '<b>bold</b><script>alert(1)</script><img src="x" onerror="alert(1)">',
  )
  assert.equal(inserted, true)
  assert.equal(editor.textContent, 'hello bold')
  assert.match(editor.innerHTML, /<b>bold<\/b>/)
  assert.doesNotMatch(editor.innerHTML, /script|img|onerror/)
  assert.equal(stop(), 1)
})

test('insertHtmlAtCaret: rejects content that sanitises to nothing', () => {
  const { editor } = createEditor('hello')
  selectText(editor, 5, 5)
  assert.equal(insertHtmlAtCaret(editor, '<script>alert(1)</script>'), false)
  assert.equal(editor.innerHTML, 'hello')
})

test('copySelection: uses execCommand when the engine supports it', async () => {
  const { document, editor } = createEditor('hello world')
  selectText(editor, 6, 11)
  const calls = []
  document.execCommand = (command) => {
    calls.push(command)
    return command === 'copy'
  }
  assert.equal(await copySelection(editor, null), true)
  assert.deepEqual(calls, ['copy'])
})

test('copySelection: falls back to the Clipboard API', async () => {
  const { editor } = createEditor('hello world')
  selectText(editor, 6, 11)
  const written = []
  const clipboard = {
    writeText: async (text) => {
      written.push(text)
    },
  }
  assert.equal(await copySelection(editor, clipboard), true)
  assert.deepEqual(written, ['world'])
})

test('copySelection: false without a selection or clipboard support', async () => {
  const { editor } = createEditor('hello world')
  assert.equal(await copySelection(editor, null), false)
  selectText(editor, 0, 5)
  assert.equal(await copySelection(editor, null), false)
})

test('cutSelection: writes to the clipboard, removes the text and reports input', async () => {
  const { editor } = createEditor('hello world')
  const stop = countInputEvents(editor)
  selectText(editor, 6, 11)
  const written = []
  const clipboard = {
    writeText: async (text) => {
      written.push(text)
    },
  }
  assert.equal(await cutSelection(editor, clipboard), true)
  assert.deepEqual(written, ['world'])
  assert.equal(editor.innerHTML, 'hello ')
  assert.equal(stop(), 1)
})

test('cutSelection: uses execCommand when available', async () => {
  const { document, editor } = createEditor('hello world')
  selectText(editor, 6, 11)
  document.execCommand = (command) => command === 'cut'
  assert.equal(await cutSelection(editor, null), true)
})

test('pasteAtCaret: inserts clipboard text at the caret', async () => {
  const { editor } = createEditor('hello ')
  const stop = countInputEvents(editor)
  selectText(editor, 6, 6)
  const clipboard = {
    readText: async () => 'pasted',
  }
  assert.equal(await pasteAtCaret(editor, clipboard), true)
  assert.equal(editor.innerHTML, 'hello pasted')
  assert.equal(stop(), 1)
})

test('pasteAtCaret: prefers sanitised rich text from the clipboard', async () => {
  const { editor } = createEditor('hello ')
  selectText(editor, 6, 6)
  const clipboard = {
    read: async () => [
      {
        types: ['text/html'],
        getType: async () => ({
          text: async () => '<b>bold</b><script>alert(1)</script>',
        }),
      },
    ],
  }
  assert.equal(await pasteAtCaret(editor, clipboard), true)
  assert.equal(editor.textContent, 'hello bold')
  assert.match(editor.innerHTML, /<b>bold<\/b>/)
  assert.doesNotMatch(editor.innerHTML, /script/)
})

test('pasteAtCaret: false when the clipboard is empty or unreadable', async () => {
  const { editor } = createEditor('hello')
  selectText(editor, 5, 5)
  assert.equal(await pasteAtCaret(editor, null), false)
  assert.equal(
    await pasteAtCaret(editor, {
      readText: async () => {
        throw new Error('denied')
      },
    }),
    false,
  )
  assert.equal(await pasteAtCaret(editor, { readText: async () => '' }), false)
})
