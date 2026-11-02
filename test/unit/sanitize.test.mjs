/**
 * Unit tests for the rich-text whitelist (`src/shared/sanitize.js`).
 *
 * Every behavioural case runs twice: once through the no-DOM fallback (the
 * default in Node) and once through `DOMParser` injected from jsdom (the path a
 * browser takes), because the two implementations must agree. The XSS table
 * additionally asserts that no dangerous token survives either path.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import {
  ALLOWED_TAGS,
  escapeHtml,
  htmlToPlainText,
  MAX_IMAGE_SRC_LENGTH,
  normalizeCssColor,
  normalizeImageDataUrl,
  sanitizeHtml,
  sanitizeStyle,
} from '../../src/shared/sanitize.js'

/** A DOM purely used to borrow `DOMParser` for the browser path. */
const dom = new JSDOM('<!doctype html><html><body></body></html>')

/**
 * Run a callback with a `DOMParser` installed on `globalThis`, restoring the
 * previous state afterwards.
 * @param callback - code to run.
 * @returns whatever the callback returns.
 */
function withDomParser(callback) {
  const previous = globalThis.DOMParser
  globalThis.DOMParser = dom.window.DOMParser
  try {
    return callback()
  } finally {
    if (previous === undefined) delete globalThis.DOMParser
    else globalThis.DOMParser = previous
  }
}

/**
 * Run a callback without a global `DOMParser`, forcing the fallback path.
 * @param callback - code to run.
 * @returns whatever the callback returns.
 */
function withoutDomParser(callback) {
  const previous = globalThis.DOMParser
  delete globalThis.DOMParser
  try {
    return callback()
  } finally {
    if (previous !== undefined) globalThis.DOMParser = previous
  }
}

/** Inputs whose sanitised output is deterministic and identical on both paths. */
const CASES = [
  {
    name: 'keeps paragraphs and inline formatting',
    input: '<p>hello <b>bold</b> <i>it</i> <u>u</u> <s>s</s></p>',
    expected: '<p>hello <b>bold</b> <i>it</i> <u>u</u> <s>s</s></p>',
  },
  {
    name: 'keeps lists, quotes, code and pre',
    input:
      '<ul><li>one</li></ul><ol><li>two</li></ol><blockquote><code>x</code><pre>y</pre></blockquote>',
    expected:
      '<ul><li>one</li></ul><ol><li>two</li></ol><blockquote><code>x</code><pre>y</pre></blockquote>',
  },
  {
    name: 'keeps br and div',
    input: 'a<br/>b<div>c</div>',
    expected: 'a<br>b<div>c</div>',
  },
  {
    name: 'removes script together with its body',
    input: '<p>ok</p><script>alert(1)</script>',
    expected: '<p>ok</p>',
  },
  {
    name: 'removes style elements',
    input: 'a<style>body{color:red}</style>b',
    expected: 'ab',
  },
  {
    name: 'removes iframes and their fallback text',
    input: '<iframe src="https://evil">fallback</iframe>',
    expected: '',
  },
  {
    name: 'removes svg and math trees',
    input: '<svg><text>evil</text></svg><math><mtext>m</mtext></math>',
    expected: '',
  },
  {
    name: 'drops images without an inline data source',
    input: '<img src="x" onerror="alert(1)">text',
    expected: 'text',
  },
  {
    name: 'keeps inline image data URLs',
    input: '<img src="data:image/png;base64,iVBORw0KGgo=">',
    expected: '<img src="data:image/png;base64,iVBORw0KGgo=">',
  },
  {
    name: 'drops remote image sources and their handlers',
    input: '<img src="https://tracker.example/pixel.png" onerror="alert(1)">',
    expected: '',
  },
  {
    name: 'drops svg image data URLs',
    input: '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">',
    expected: '',
  },
  {
    name: 'drops javascript image sources',
    input: '<img src="javascript:alert(1)">',
    expected: '',
  },
  {
    name: 'keeps the data URL while dropping extra image attributes',
    input: '<img src="data:image/png;base64,AAAA" width="9999" onerror="alert(1)">',
    expected: '<img src="data:image/png;base64,AAAA">',
  },
  {
    name: 'unwraps links so the text survives',
    input: '<a href="javascript:alert(1)">click</a>',
    expected: 'click',
  },
  {
    name: 'drops event handler attributes',
    input: '<b onclick="alert(1)" onmouseover="x()">bold</b>',
    expected: '<b>bold</b>',
  },
  {
    name: 'drops class/id/data attributes',
    input: '<p class="x" id="y" data-z="1">text</p>',
    expected: '<p>text</p>',
  },
  {
    name: 'keeps only colour declarations from style',
    input:
      '<p style="color: red; background-image: url(javascript:alert(1)); position: fixed">hi</p>',
    expected: '<p style="color: red">hi</p>',
  },
  {
    name: 'rejects expression colours',
    input: '<span style="background-color: expression(alert(1))">x</span>',
    expected: 'x',
  },
  {
    name: 'rejects url colours',
    input: '<span style="background-color: url(#x)">y</span>',
    expected: 'y',
  },
  {
    name: 'rejects var colours',
    input: '<span style="color: var(--brand)">z</span>',
    expected: 'z',
  },
  {
    name: 'normalises font colour to a span',
    input: '<font color="#FF0000">red</font>',
    expected: '<span style="color: #ff0000">red</span>',
  },
  {
    name: 'normalises font style colour to a span',
    input: '<font style="color: RED">red</font>',
    expected: '<span style="color: red">red</span>',
  },
  {
    name: 'keeps mark highlights',
    input: '<mark style="background-color: #FFF3A3">hi</mark>',
    expected: '<mark style="background-color: #fff3a3">hi</mark>',
  },
  {
    name: 'keeps span colours and rgb serialisation',
    input: '<span style="color: rgb(1, 2, 3)">x</span>',
    expected: '<span style="color: rgb(1, 2, 3)">x</span>',
  },
  {
    name: 'unwraps unstyled spans',
    input: '<span class="x">plain</span>',
    expected: 'plain',
  },
  {
    name: 'unwraps unknown block elements',
    input: '<h1>Title</h1>',
    expected: 'Title',
  },
  {
    name: 'drops comments',
    input: 'a<!-- note -->b',
    expected: 'ab',
  },
  {
    name: 'escapes entity text exactly once',
    input: '<p>a&amp;b</p>',
    expected: '<p>a&amp;b</p>',
  },
  {
    name: 'escapes literal script-looking text',
    input: '&lt;script&gt;alert(1)&lt;/script&gt;',
    expected: '&lt;script&gt;alert(1)&lt;/script&gt;',
  },
]

/** Hostile inputs: sanitised output must not contain any of these tokens. */
const XSS_INPUTS = [
  '<script>alert(1)</script>',
  '<SCRIPT SRC=//evil.example></SCRIPT>',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="javascript:alert(1)">x</a>',
  '<p onclick="alert(1)">x</p>',
  '<style>body{background:url(javascript:alert(1))}</style>',
  '<math><mtext>m</mtext></math>',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="javascript:alert(1)">',
  '"><script>alert(1)</script>',
  '</p><script>alert(1)</script>',
  '<p style="color:expression(alert(1))">x</p>',
  '<p style="color:url(javascript:alert(1))">x</p>',
  '<p style="color:var(--x)">x</p>',
  '<template><img src=x onerror=alert(1)></template>',
  '<!--<script>alert(1)</script>-->',
  '<p style="background-color: red" onmouseenter="alert(1)">x</p>',
  '<form><input onfocus="alert(1)" autofocus></form>',
]

/** Tokens that must never appear in sanitised output. */
const FORBIDDEN_OUTPUT =
  /<script|<style|<iframe|<img|<svg|<object|<embed|<form|<input|onerror|onload|onfocus|onmouse|javascript:|expression\(|url\(/i

test('sanitizeHtml: whitelist table matches on the fallback and DOMParser paths', () => {
  for (const { name, input, expected } of CASES) {
    const fallback = withoutDomParser(() => sanitizeHtml(input))
    const domResult = withDomParser(() => sanitizeHtml(input))
    assert.equal(fallback, expected, `fallback path: ${name}`)
    assert.equal(domResult, expected, `DOMParser path: ${name}`)
  }
})

test('sanitizeHtml: strips every dangerous token on both paths', () => {
  for (const input of XSS_INPUTS) {
    const fallback = withoutDomParser(() => sanitizeHtml(input))
    const domResult = withDomParser(() => sanitizeHtml(input))
    assert.doesNotMatch(fallback, FORBIDDEN_OUTPUT, `fallback path leaked: ${input}`)
    assert.doesNotMatch(domResult, FORBIDDEN_OUTPUT, `DOMParser path leaked: ${input}`)
  }
})

test('sanitizeHtml: is idempotent on both paths', () => {
  const inputs = [...CASES.map((entry) => entry.input), ...XSS_INPUTS]
  for (const input of inputs) {
    const fallback = withoutDomParser(() => sanitizeHtml(input))
    const domResult = withDomParser(() => sanitizeHtml(input))
    assert.equal(
      withoutDomParser(() => sanitizeHtml(fallback)),
      fallback,
      `fallback: ${input}`,
    )
    assert.equal(
      withDomParser(() => sanitizeHtml(domResult)),
      domResult,
      `DOMParser: ${input}`,
    )
  }
})

test('sanitizeHtml: never throws on malformed or non-string input', () => {
  const inputs = [null, undefined, '', '   ', 42, '<', '<<', '<p', '</p>', '"><img', '\u0000']
  for (const input of inputs) {
    assert.doesNotThrow(() => withoutDomParser(() => sanitizeHtml(input)))
    assert.doesNotThrow(() => withDomParser(() => sanitizeHtml(input)))
  }
  assert.equal(sanitizeHtml(null), '')
  assert.equal(sanitizeHtml(undefined), '')
  assert.equal(sanitizeHtml(''), '')
})

test('sanitizeHtml: falls back safely when DOMParser throws', () => {
  const previous = globalThis.DOMParser
  globalThis.DOMParser = class BrokenParser {
    parseFromString() {
      throw new Error('parser exploded')
    }
  }
  try {
    assert.equal(sanitizeHtml('<b>ok</b><script>alert(1)</script>'), '<b>ok</b>')
  } finally {
    if (previous === undefined) delete globalThis.DOMParser
    else globalThis.DOMParser = previous
  }
})

test('ALLOWED_TAGS: is the documented whitelist', () => {
  assert.deepEqual(
    [...ALLOWED_TAGS],
    [
      'p',
      'div',
      'br',
      'img',
      'b',
      'strong',
      'i',
      'em',
      'u',
      's',
      'mark',
      'span',
      'ul',
      'ol',
      'li',
      'blockquote',
      'code',
      'pre',
    ],
  )
  assert.ok(!ALLOWED_TAGS.includes('script'))
  assert.ok(ALLOWED_TAGS.includes('img'))
  assert.ok(!ALLOWED_TAGS.includes('a'))
})

test('normalizeCssColor: accepts safe values and rejects injection', () => {
  assert.equal(normalizeCssColor('#FFF'), '#fff')
  assert.equal(normalizeCssColor('  RED  '), 'red')
  assert.equal(normalizeCssColor('rgb(255, 243, 163)'), 'rgb(255, 243, 163)')
  assert.equal(normalizeCssColor('rgba(1, 2, 3, 0.5)'), 'rgba(1, 2, 3, 0.5)')
  assert.equal(normalizeCssColor('hsl(120 50% 50%)'), 'hsl(120 50% 50%)')
  assert.equal(normalizeCssColor('transparent'), 'transparent')
  assert.equal(normalizeCssColor('inherit'), 'inherit')
  assert.equal(normalizeCssColor('#12345'), null)
  assert.equal(normalizeCssColor('url(#x)'), null)
  assert.equal(normalizeCssColor('expression(alert(1))'), null)
  assert.equal(normalizeCssColor('var(--x)'), null)
  assert.equal(normalizeCssColor('rgb(1,2,3); background:url(x)'), null)
  assert.equal(normalizeCssColor(''), null)
  assert.equal(normalizeCssColor(null), null)
  assert.equal(normalizeCssColor(123), null)
})

test('sanitizeStyle: keeps only validated colour declarations', () => {
  assert.equal(
    sanitizeStyle('color: RED; background-color: #ABC'),
    'color: red; background-color: #abc',
  )
  assert.equal(sanitizeStyle('position: fixed; color: red'), 'color: red')
  assert.equal(sanitizeStyle('background-image: url(x)'), '')
  assert.equal(sanitizeStyle('color: expression(alert(1))'), '')
  assert.equal(sanitizeStyle(''), '')
  assert.equal(sanitizeStyle(null), '')
})

test('escapeHtml: escapes the five HTML-significant characters', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;'&lt;/a&gt;")
  assert.equal(escapeHtml(null), '')
})

test('htmlToPlainText: extracts readable text and line breaks', () => {
  assert.equal(htmlToPlainText('<p>hello <b>world</b></p>'), 'hello world')
  assert.equal(htmlToPlainText('<p>one</p><p>two</p>'), 'one\ntwo')
  assert.equal(htmlToPlainText('a<br>b'), 'a\nb')
  assert.equal(htmlToPlainText('<p>a&nbsp;b</p>'), 'a b')
  assert.equal(htmlToPlainText('<ul><li>a</li><li>b</li></ul>'), 'a\nb')
  assert.equal(htmlToPlainText('<script>alert(1)</script>text'), 'text')
  assert.equal(htmlToPlainText('<p>  spaced   out  </p>'), 'spaced out')
  assert.equal(htmlToPlainText(''), '')
  assert.equal(htmlToPlainText(null), '')
})

test('htmlToPlainText: counts characters after whitespace removal', () => {
  const text = htmlToPlainText('<p>hello <b>世界</b></p><p>second line</p>')
  assert.equal(text.replace(/\s+/g, '').length, 'hello世界secondline'.length)
})

test('normalizeImageDataUrl: only bounded inline raster data URLs survive', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo='
  assert.equal(normalizeImageDataUrl(png), png)
  assert.equal(normalizeImageDataUrl('data:image/jpeg;base64,AAAA'), 'data:image/jpeg;base64,AAAA')
  assert.equal(normalizeImageDataUrl('data:image/webp;base64,AAAA'), 'data:image/webp;base64,AAAA')
  assert.equal(normalizeImageDataUrl('data:image/gif;base64,AAAA'), 'data:image/gif;base64,AAAA')
  assert.equal(
    normalizeImageDataUrl('  data:image/png;base64,AAAA  '),
    'data:image/png;base64,AAAA',
  )
  assert.equal(normalizeImageDataUrl('https://example.com/x.png'), null)
  assert.equal(normalizeImageDataUrl('//example.com/x.png'), null)
  assert.equal(normalizeImageDataUrl('javascript:alert(1)'), null)
  assert.equal(normalizeImageDataUrl('data:image/svg+xml;base64,PHN2Zz4='), null)
  assert.equal(normalizeImageDataUrl('data:text/html;base64,PHNjcmlwdD4='), null)
  assert.equal(normalizeImageDataUrl('data:image/png;base64,'), null)
  assert.equal(normalizeImageDataUrl('data:image/png;base64,AA AA'), null)
  assert.equal(normalizeImageDataUrl('data:image/png,not-base64'), null)
  assert.equal(normalizeImageDataUrl(null), null)
  assert.equal(normalizeImageDataUrl(42), null)
})

test('sanitizeHtml: drops inline images that exceed the source length cap', () => {
  const oversized = `data:image/png;base64,${'A'.repeat(MAX_IMAGE_SRC_LENGTH)}`
  const input = `<img src="${oversized}">`
  assert.equal(
    withoutDomParser(() => sanitizeHtml(input)),
    '',
  )
  assert.equal(
    withDomParser(() => sanitizeHtml(input)),
    '',
  )
  assert.equal(normalizeImageDataUrl(oversized), null)
})

test('sanitizeHtml: keeps an accepted image on both paths', () => {
  const input = '<p>before</p><img src="data:image/png;base64,AAAA"><p>after</p>'
  const expected = '<p>before</p><img src="data:image/png;base64,AAAA"><p>after</p>'
  assert.equal(
    withoutDomParser(() => sanitizeHtml(input)),
    expected,
  )
  assert.equal(
    withDomParser(() => sanitizeHtml(input)),
    expected,
  )
})

test('htmlToPlainText: ignores inline images', () => {
  const input = '<p>before</p><img src="data:image/png;base64,AAAA"><p>after</p>'
  assert.equal(htmlToPlainText(input), 'before\nafter')
  assert.equal(htmlToPlainText('<img src="data:image/png;base64,AAAA">'), '')
})
