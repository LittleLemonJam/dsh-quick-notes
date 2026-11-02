/**
 * Editor component tests (jsdom + react-dom).
 *
 * These cover the behaviours unit tests cannot see: the contentEditable reload
 * on a whole-state replacement (contentEpoch), drag-and-drop going through the
 * sanitiser instead of the browser's default insertion, pasted/dropped images
 * being ingested (or gracefully ignored when canvas is unavailable), the inline
 * title rename and the lined-paper styles.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM, VirtualConsole } from 'jsdom'

// jsdom has no canvas implementation; swallow its "not implemented" noise so the
// graceful-degradation paths can be asserted without polluting the test output.
const virtualConsole = new VirtualConsole()
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'http://127.0.0.1:58587/',
  virtualConsole,
})

globalThis.window = dom.window
globalThis.document = dom.window.document
// Node exposes `navigator` as a getter-only global; replace its descriptor.
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
})
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = React
const { CSS: EDITOR_CSS, NoteEditor } = await import('../../src/client/components/editor.js')

const h = React.createElement

/**
 * Minimal translator: returns the key plus serialised params.
 * @param key - dictionary key.
 * @param params - interpolation values.
 * @returns the fake translation.
 */
function t(key, params) {
  return params === undefined ? key : `${key}${JSON.stringify(params)}`
}

/**
 * Build a note.
 * @param html - note HTML.
 * @returns the note object.
 */
function noteWith(html) {
  return {
    id: 'n_test',
    title: 'Test note',
    html,
    pinned: false,
    createdAt: 1,
    updatedAt: 2,
  }
}

/**
 * Build the slice of state the editor reads.
 * @param contentEpoch - whole-state replacement counter.
 * @param settings - settings overrides (font size, line height, ruled lines).
 * @returns the state object.
 */
function editorState(contentEpoch = 0, settings = {}) {
  return {
    settings: { fontSize: 15, lineHeight: 1.75, ...settings },
    contentEpoch,
  }
}

/**
 * Mount the editor and return its handles.
 * @param note - active note.
 * @param state - editor state slice.
 * @returns `{ root, container, body, actions, calls, renames, render, unmount }`.
 */
async function mount(note, state) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const calls = []
  const renames = []
  const actions = {
    setNoteHtml(id, html) {
      calls.push({ id, html })
    },
    renameNote(id, title) {
      renames.push({ id, title })
    },
  }
  const render = async (nextNote, nextState) => {
    await act(async () => {
      root.render(
        h(NoteEditor, {
          t,
          state: nextState,
          actions,
          note: nextNote,
        }),
      )
    })
  }
  await render(note, state)
  const body = container.querySelector('[data-qn-editor-body]')
  return {
    root,
    container,
    body,
    actions,
    calls,
    renames,
    render,
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

test('the contentEditable reloads when contentEpoch changes, not on every keystroke', async () => {
  const editor = await mount(noteWith('<p>first</p>'), editorState(0))
  try {
    assert.match(editor.body.innerHTML, /first/)

    // A local edit lives only in the DOM until the input event fires; a state
    // update with the same note id and epoch must not rewrite it.
    editor.body.innerHTML = '<p>typed locally</p>'
    await editor.render(noteWith('<p>stale state</p>'), editorState(0))
    assert.match(editor.body.innerHTML, /typed locally/)

    // A whole-state replacement (newer Host copy / JSON import) bumps the
    // epoch, so the editor reloads even though the note id did not change.
    await editor.render(noteWith('<p>second</p>'), editorState(1))
    assert.match(editor.body.innerHTML, /second/)
  } finally {
    await editor.unmount()
  }
})

test('a dropped HTML payload is sanitised before it reaches the DOM', async () => {
  const editor = await mount(noteWith(''), editorState(0))
  try {
    const selection = document.getSelection()
    const range = document.createRange()
    range.selectNodeContents(editor.body)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)

    const transfer = {
      getData(type) {
        if (type === 'text/html') {
          return '<p>dropped<script>alert(1)</script><img src=x onerror=alert(1)></p>'
        }
        return 'dropped'
      },
    }
    const event = new dom.window.MouseEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: 5,
      clientY: 5,
    })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    await act(async () => {
      editor.body.dispatchEvent(event)
    })

    assert.equal(event.defaultPrevented, true)
    assert.equal(editor.body.innerHTML.includes('<script'), false)
    assert.equal(editor.body.innerHTML.toLowerCase().includes('onerror'), false)
    assert.match(editor.body.innerHTML, /dropped/)
  } finally {
    await editor.unmount()
  }
})

/**
 * Set the value of a controlled input the way a user would.
 * @param input - input element.
 * @param value - new value.
 */
async function typeIntoInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}

/**
 * Open the inline title editor with a double-click.
 * @param container - mounted editor container.
 * @returns the title input element.
 */
async function openTitleEditor(container) {
  const heading = container.querySelector('[data-qn-editor-title]')
  assert.notEqual(heading, null, 'the read-only title must be rendered')
  await act(async () => {
    heading.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }))
  })
  const input = container.querySelector('[data-qn-title-input]')
  assert.notEqual(input, null, 'double-click must open the inline title input')
  return input
}

test('double-clicking the title opens a focused, selected inline input', async () => {
  const editor = await mount(noteWith('<p>body</p>'), editorState(0))
  try {
    const input = await openTitleEditor(editor.container)
    assert.equal(input.value, 'Test note')
    assert.equal(document.activeElement, input)
    assert.equal(input.selectionStart, 0)
    assert.equal(input.selectionEnd, 'Test note'.length)
  } finally {
    await editor.unmount()
  }
})

test('Enter in the title input renames the note through the store action', async () => {
  const editor = await mount(noteWith('<p>body</p>'), editorState(0))
  try {
    const input = await openTitleEditor(editor.container)
    await typeIntoInput(input, 'Renamed note')
    await act(async () => {
      input.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      )
    })
    assert.deepEqual(editor.renames, [{ id: 'n_test', title: 'Renamed note' }])
    assert.equal(editor.container.querySelector('[data-qn-title-input]'), null)

    // The store update flows back into the header on the next render.
    await editor.render({ ...noteWith('<p>body</p>'), title: 'Renamed note' }, editorState(0))
    assert.equal(
      editor.container.querySelector('[data-qn-editor-title]').textContent,
      'Renamed note',
    )
  } finally {
    await editor.unmount()
  }
})

test('Escape in the title input cancels the rename', async () => {
  const editor = await mount(noteWith('<p>body</p>'), editorState(0))
  try {
    const input = await openTitleEditor(editor.container)
    await typeIntoInput(input, 'Discarded')
    await act(async () => {
      input.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
    })
    assert.deepEqual(editor.renames, [])
    assert.equal(editor.container.querySelector('[data-qn-title-input]'), null)
    assert.equal(editor.container.querySelector('[data-qn-editor-title]').textContent, 'Test note')
  } finally {
    await editor.unmount()
  }
})

test('blurring the title input commits, empty drafts keep the original name', async () => {
  const editor = await mount(noteWith('<p>body</p>'), editorState(0))
  try {
    const input = await openTitleEditor(editor.container)
    await typeIntoInput(input, 'Blurred name')
    await act(async () => {
      input.blur()
    })
    assert.deepEqual(editor.renames, [{ id: 'n_test', title: 'Blurred name' }])
    assert.equal(editor.container.querySelector('[data-qn-title-input]'), null)
  } finally {
    await editor.unmount()
  }

  const second = await mount(noteWith('<p>body</p>'), editorState(0))
  try {
    const input = await openTitleEditor(second.container)
    await typeIntoInput(input, '   ')
    await act(async () => {
      input.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      )
    })
    assert.deepEqual(second.renames, [])
  } finally {
    await second.unmount()
  }
})

test('ruledLines adds the ruled class and the line-height CSS variable', async () => {
  const ruled = await mount(noteWith('<p>x</p>'), editorState(0, { ruledLines: true }))
  try {
    assert.equal(ruled.body.classList.contains('qn-editor-ruled'), true)
    assert.equal(ruled.body.style.getPropertyValue('--qn-line-height'), '26.25px')
  } finally {
    await ruled.unmount()
  }

  const custom = await mount(
    noteWith('<p>x</p>'),
    editorState(0, { ruledLines: true, fontSize: 16, lineHeight: 1.5 }),
  )
  try {
    assert.equal(custom.body.style.getPropertyValue('--qn-line-height'), '24px')
  } finally {
    await custom.unmount()
  }

  const plain = await mount(noteWith('<p>x</p>'), editorState(0, { ruledLines: false }))
  try {
    assert.equal(plain.body.classList.contains('qn-editor-ruled'), false)
    assert.equal(plain.body.style.getPropertyValue('--qn-line-height'), '')
  } finally {
    await plain.unmount()
  }
})

test('editor CSS paints the paper and ruled lines through theme variables', () => {
  assert.match(EDITOR_CSS, /\.qn-main\s*\{[^}]*background:\s*var\(--qn-paper-bg/)
  const ruled = /\.qn-editor-ruled\s*\{([\s\S]*?)\}/.exec(EDITOR_CSS)
  assert.notEqual(ruled, null, 'the ruled-line rule must exist')
  assert.match(ruled[1], /repeating-linear-gradient/)
  assert.match(ruled[1], /var\(--qn-rule-color/)
  assert.match(ruled[1], /var\(--qn-line-height/)
  assert.doesNotMatch(EDITOR_CSS, /#[0-9a-fA-F]{3,8}\b/, 'editor CSS must not hard-code colours')
})

/**
 * Dispatch a paste/drop event carrying files on an editor body.
 * @param body - contentEditable element.
 * @param type - `'paste'` or `'drop'`.
 * @param files - fake `File`-like objects.
 * @returns the dispatched event.
 */
async function dispatchFilesEvent(body, type, files) {
  const EventCtor = type === 'drop' ? dom.window.MouseEvent : dom.window.Event
  const event = new EventCtor(type, {
    bubbles: true,
    cancelable: true,
    clientX: 5,
    clientY: 5,
  })
  Object.defineProperty(event, 'clipboardData', { value: { files, getData: () => '' } })
  Object.defineProperty(event, 'dataTransfer', { value: { files, getData: () => '' } })
  await act(async () => {
    body.dispatchEvent(event)
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return event
}

test('pasting an image file without canvas support is ignored, not thrown', async () => {
  const editor = await mount(noteWith('<p>text</p>'), editorState(0))
  try {
    const file = { type: 'image/png', size: 2048, name: 'screenshot.png' }
    const event = await dispatchFilesEvent(editor.body, 'paste', [file])
    assert.equal(event.defaultPrevented, true)
    assert.doesNotMatch(editor.body.innerHTML, /<img/)
    assert.equal(editor.body.textContent, 'text')
  } finally {
    await editor.unmount()
  }
})

test('dropping an image file without canvas support is ignored', async () => {
  const editor = await mount(noteWith('<p>text</p>'), editorState(0))
  try {
    const file = { type: 'image/jpeg', size: 4096, name: 'photo.jpg' }
    const event = await dispatchFilesEvent(editor.body, 'drop', [file])
    assert.equal(event.defaultPrevented, true)
    assert.doesNotMatch(editor.body.innerHTML, /<img/)
    assert.equal(editor.body.textContent, 'text')
  } finally {
    await editor.unmount()
  }
})

test('the editor loads inline images but strips remote ones', async () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
  const html = `<p>a</p><img src="${dataUrl}"><p>b</p><img src="https://evil.example/x.png" onerror="alert(1)">`
  const editor = await mount(noteWith(html), editorState(0))
  try {
    const images = editor.body.querySelectorAll('img')
    assert.equal(images.length, 1)
    assert.equal(images[0].getAttribute('src'), dataUrl)
    assert.doesNotMatch(editor.body.innerHTML, /evil|onerror/)
    assert.equal(editor.body.textContent, 'ab')
  } finally {
    await editor.unmount()
  }
})

test('editor CSS clamps images to the editor width', () => {
  const rule = /\.qn-editor-body img\s*\{([\s\S]*?)\}/.exec(EDITOR_CSS)
  assert.notEqual(rule, null, 'the image rule must exist')
  assert.match(rule[1], /max-width:\s*100%/)
  assert.match(rule[1], /height:\s*auto/)
  assert.match(rule[1], /display:\s*block/)
})
