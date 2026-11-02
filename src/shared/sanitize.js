/**
 * Rich-text sanitiser (whitelist).
 *
 * The editor, the persistence boundary and the unit tests all share this
 * module, so it must stay dependency-free and environment-agnostic:
 *
 * - in a browser (and under jsdom in tests) it walks the tree produced by
 *   `DOMParser`, which is the only correct way to parse HTML;
 * - in Node without a DOM it falls back to a small tokenizer that emits only
 *   whitelisted tags and strictly validated colour declarations. The fallback
 *   never trusts an attribute value, so untrusted pasted HTML cannot smuggle
 *   scripts, event handlers or URLs into a note.
 *
 * Surviving markup is exactly what the editor itself produces:
 *   p, div, br, b, strong, i, em, u, s, mark, span, ul, ol, li, blockquote,
 *   code, pre, img
 * The only surviving attributes are `style`, restricted to `color` and
 * `background-color` with a colour value validated against a strict grammar,
 * and `src` on `<img>`, restricted to a bounded inline `data:image/*;base64,`
 * URL (no remote sources, no SVG, no scripts). Legacy `<font color>` (produced
 * by `execCommand` without `styleWithCSS`) is normalised to
 * `<span style="color: …">`. Every other element is unwrapped (children kept)
 * unless it is a script-like element, which is removed with its content.
 */

/** Tags kept in persisted notes. */
export const ALLOWED_TAGS = Object.freeze([
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
])

/** Whitelist as a set, for cheap lookups while serialising. */
const ALLOWED_TAG_SET = new Set(ALLOWED_TAGS)

/**
 * Elements removed together with their content. Unwrapping them would leak
 * script bodies, stylesheets or fallback text that is never safe to render.
 */
const DROP_WITH_CONTENT = new Set([
  'applet',
  'base',
  'button',
  'canvas',
  'embed',
  'frame',
  'frameset',
  'head',
  'iframe',
  'link',
  'math',
  'meta',
  'noembed',
  'noframes',
  'noscript',
  'object',
  'plaintext',
  'script',
  'select',
  'style',
  'svg',
  'template',
  'textarea',
  'title',
  'xmp',
])

/** Void/self-contained elements removed without keeping anything. */
const DROP_VOID_NAMES = Object.freeze([
  'area',
  'base',
  'col',
  'embed',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
])

/** Style properties content is allowed to carry. */
const ALLOWED_STYLE_PROPERTIES = Object.freeze(['color', 'background-color'])

/** Maximum accepted length of one inline image data URL (characters). */
export const MAX_IMAGE_SRC_LENGTH = 500_000

/**
 * The only image source the editor may persist: a bounded inline raster data
 * URL. Remote URLs (tracking pixels), `data:image/svg+xml` (scriptable) and
 * `javascript:` are all rejected by the anchored grammar.
 */
const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/]+={0,2}$/i

/** Colour value grammar: hex, rgb()/hsl() functions or a CSS colour keyword. */
const COLOR_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/
const COLOR_FUNCTION = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.%+\-,\s/]+\)$/
const COLOR_KEYWORD = /^[a-z]{3,20}$/

/** Substrings that mark a colour value as an injection attempt. */
const COLOR_BLACKLIST = /(?:expression|javascript|vbscript|behavior|binding|import|url|var\s*\()/i

/** Maximum accepted length of one colour value. */
const MAX_COLOR_LENGTH = 64

/** Largest code point a numeric entity may reference. */
const MAX_CODE_POINT = 0x10ffff

/** Node type constants (avoids depending on the global `Node` object). */
const ELEMENT_NODE = 1
const TEXT_NODE = 3
const CDATA_SECTION_NODE = 4

/** Named entities the serialiser may emit, decoded for plain text. */
const NAMED_ENTITIES = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
})

/**
 * Escape text for safe interpolation into HTML.
 * @param text - raw text.
 * @returns escaped text.
 */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Decode the small entity set the sanitiser emits (plus numeric references).
 * @param text - escaped text.
 * @returns decoded text.
 */
function decodeEntities(text) {
  return String(text ?? '').replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (entity, decimal, hex, name) => {
      if (decimal !== undefined) {
        const code = Number.parseInt(decimal, 10)
        return Number.isInteger(code) && code > 0 && code <= MAX_CODE_POINT
          ? String.fromCodePoint(code)
          : entity
      }
      if (hex !== undefined) {
        const code = Number.parseInt(hex, 16)
        return Number.isInteger(code) && code > 0 && code <= MAX_CODE_POINT
          ? String.fromCodePoint(code)
          : entity
      }
      return NAMED_ENTITIES[String(name).toLowerCase()] ?? entity
    },
  )
}

/**
 * Validate and canonicalise one CSS colour value.
 *
 * The grammar is intentionally narrow: content colours only need hex values
 * (the palette), `rgb()`/`hsl()` (browser serialisation) and plain CSS colour
 * keywords. Anything that can execute or fetch (`expression`, `url`, `var`,
 * escapes) is rejected outright.
 *
 * @param value - candidate colour value.
 * @returns canonical lower-case value, or null when unsafe/invalid.
 */
export function normalizeCssColor(value) {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/\s+/g, ' ')
  if (text === '' || text.length > MAX_COLOR_LENGTH) return null
  if (COLOR_BLACKLIST.test(text)) return null
  const lower = text.toLowerCase()
  if (COLOR_HEX.test(lower) || COLOR_FUNCTION.test(lower) || COLOR_KEYWORD.test(lower)) {
    return lower
  }
  return null
}

/**
 * Parse an inline style attribute and keep only allowed colour declarations.
 * @param styleText - raw `style` attribute value.
 * @returns canonical `property: value` string (possibly empty).
 */
export function sanitizeStyle(styleText) {
  const declarations = new Map()
  for (const chunk of String(styleText ?? '').split(';')) {
    const separator = chunk.indexOf(':')
    if (separator <= 0) continue
    const property = chunk.slice(0, separator).trim().toLowerCase()
    if (!ALLOWED_STYLE_PROPERTIES.includes(property)) continue
    const value = normalizeCssColor(chunk.slice(separator + 1))
    if (value !== null) declarations.set(property, value)
  }
  return [...declarations].map(([property, value]) => `${property}: ${value}`).join('; ')
}

/**
 * Read the first valid `color` declaration from a style attribute.
 * @param styleText - raw `style` attribute value.
 * @returns canonical colour or null.
 */
function colorFromStyle(styleText) {
  for (const chunk of String(styleText ?? '').split(';')) {
    const separator = chunk.indexOf(':')
    if (separator <= 0) continue
    if (chunk.slice(0, separator).trim().toLowerCase() !== 'color') continue
    const value = normalizeCssColor(chunk.slice(separator + 1))
    if (value !== null) return value
  }
  return null
}

/**
 * Validate and canonicalise an `<img src>` value.
 *
 * Only a bounded inline raster data URL survives; anything that could load a
 * remote resource or execute script (http(s), protocol-relative, `javascript:`,
 * SVG data URLs) is rejected.
 *
 * @param value - candidate image source.
 * @returns the accepted source string, or null when unsafe/invalid.
 */
export function normalizeImageDataUrl(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '' || text.length > MAX_IMAGE_SRC_LENGTH) return null
  return IMAGE_DATA_URL_PATTERN.test(text) ? text : null
}

/**
 * Serialise one DOM node with the whitelist applied.
 * @param node - DOM node from the parser document.
 * @returns sanitised HTML.
 */
function serializeDomNode(node) {
  if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) {
    return escapeHtml(node.nodeValue ?? '')
  }
  if (node.nodeType !== ELEMENT_NODE) return ''
  const tag = String(node.tagName ?? '').toLowerCase()
  if (DROP_WITH_CONTENT.has(tag)) return ''
  if (tag === 'br') return '<br>'
  if (tag === 'img') {
    const src = normalizeImageDataUrl(node.getAttribute('src') ?? '')
    return src === null ? '' : `<img src="${src}">`
  }
  const children = serializeDomChildren(node)
  if (tag === 'font') {
    const style = sanitizeStyle(node.getAttribute('style') ?? '')
    const color = colorFromStyle(style) ?? normalizeCssColor(node.getAttribute('color') ?? '')
    if (color === null) return children
    return `<span style="color: ${color}">${children}</span>`
  }
  if (!ALLOWED_TAG_SET.has(tag)) return children
  const style = sanitizeStyle(node.getAttribute('style') ?? '')
  if (style === '') {
    return tag === 'span' ? children : `<${tag}>${children}</${tag}>`
  }
  return `<${tag} style="${style}">${children}</${tag}>`
}

/**
 * Serialise every child of a DOM node.
 * @param node - parent node.
 * @returns sanitised HTML.
 */
function serializeDomChildren(node) {
  let output = ''
  for (const child of node.childNodes) output += serializeDomNode(child)
  return output
}

/**
 * Sanitise through `DOMParser` (browser and jsdom).
 * @param html - untrusted HTML.
 * @param Parser - DOMParser constructor.
 * @returns sanitised HTML.
 */
function sanitizeWithDom(html, Parser) {
  const document = new Parser().parseFromString(html, 'text/html')
  const root = document?.body ?? document?.documentElement
  if (root === null || root === undefined) return sanitizeFallback(html)
  return serializeDomChildren(root)
}

/** Dangerous block elements, used by the no-DOM fallback pre-pass. */
const FALLBACK_BLOCK_NAMES =
  'script|style|iframe|svg|math|template|noscript|object|applet|frameset|frame|head|title|textarea|xmp|plaintext|noembed|noframes|select|button|canvas'

/** Matched dangerous blocks (opening tag through closing tag), removed. */
const FALLBACK_BLOCK_PATTERN = new RegExp(
  `<\\s*(?:${FALLBACK_BLOCK_NAMES})\\b[^>]*>[\\s\\S]*?<\\s*/\\s*(?:${FALLBACK_BLOCK_NAMES})\\s*>`,
  'gi',
)

/** Self-closing dangerous elements, removed before the paired-block pass. */
const FALLBACK_SELF_CLOSING_PATTERN = new RegExp(
  `<\\s*(?:${FALLBACK_BLOCK_NAMES})\\b[^>]*?/\\s*>`,
  'gi',
)

/** Unclosed dangerous elements: everything from the tag to the end is dropped. */
const FALLBACK_UNCLOSED_PATTERN = new RegExp(
  `<\\s*(?:${FALLBACK_BLOCK_NAMES})\\b[^>]*>[\\s\\S]*$`,
  'gi',
)

/** Void elements removed entirely (no content to keep). */
const FALLBACK_VOID_PATTERN = new RegExp(`<\\s*(?:${DROP_VOID_NAMES.join('|')})\\b[^>]*>`, 'gi')

/** One opening/closing tag, with attribute text captured separately. */
const TAG_PATTERN = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:_-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g

/** One `name="value"` / `name='value'` / `name=value` attribute. */
const ATTRIBUTE_PATTERN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g

/**
 * Remove the script-like parts the tokenizer must never see. The pass is
 * deliberately lossy: an unclosed dangerous block swallows the rest of the
 * document rather than guessing where it ends.
 * @param html - untrusted HTML.
 * @returns HTML with dangerous blocks removed.
 */
function stripDangerousBlocks(html) {
  let text = String(html ?? '')
  text = text.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
  text = text.replace(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g, '')
  text = text.replace(/<\?[\s\S]*?(?:\?>|$)/g, '')
  text = text.replace(FALLBACK_SELF_CLOSING_PATTERN, '')
  text = text.replace(FALLBACK_BLOCK_PATTERN, '')
  text = text.replace(FALLBACK_UNCLOSED_PATTERN, '')
  text = text.replace(FALLBACK_VOID_PATTERN, '')
  return text
}

/**
 * Parse a raw attribute string into a map (last duplicate wins is irrelevant:
 * first occurrence is kept, matching HTML parsing precedence closely enough
 * for a fallback).
 * @param source - attribute text without the tag name.
 * @returns attribute map.
 */
function parseAttributes(source) {
  const attributes = new Map()
  ATTRIBUTE_PATTERN.lastIndex = 0
  let match = ATTRIBUTE_PATTERN.exec(source)
  while (match !== null) {
    const name = match[1].toLowerCase()
    if (!attributes.has(name)) {
      let value = match[2]
      if (value.startsWith('"') || value.startsWith("'")) value = value.slice(1, -1)
      attributes.set(name, value)
    }
    match = ATTRIBUTE_PATTERN.exec(source)
  }
  return attributes
}

/**
 * Sanitise without a DOM by tokenising the markup and re-emitting only the
 * whitelisted subset. Text is always escaped, so leftover angle brackets can
 * never turn back into markup.
 * @param html - untrusted HTML.
 * @returns sanitised HTML.
 */
function sanitizeFallback(html) {
  const source = stripDangerousBlocks(html)
  const stack = []
  let output = ''
  let index = 0

  const closeEntry = (entry) => {
    if (entry.emitted) output += `</${entry.closeTag}>`
  }

  const popTo = (tag) => {
    let found = -1
    for (let cursor = stack.length - 1; cursor >= 0; cursor -= 1) {
      if (stack[cursor].tag === tag) {
        found = cursor
        break
      }
    }
    if (found < 0) return
    while (stack.length - 1 > found) closeEntry(stack.pop())
    closeEntry(stack.pop())
  }

  const push = (entry) => {
    stack.push(entry)
    if (entry.emitted) output += entry.open
  }

  TAG_PATTERN.lastIndex = 0
  let match = TAG_PATTERN.exec(source)
  while (match !== null) {
    const text = source.slice(index, match.index)
    if (text !== '') output += escapeHtml(decodeEntities(text))
    index = match.index + match[0].length
    const closing = match[1] === '/'
    const tag = match[2].toLowerCase()
    const attributeText = match[3] ?? ''
    match = TAG_PATTERN.exec(source)
    if (closing) {
      popTo(tag)
      continue
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      stack.push({ tag, emitted: false })
      continue
    }
    if (tag === 'br') {
      output += '<br>'
      continue
    }
    if (tag === 'img') {
      const attributes = parseAttributes(attributeText)
      const src = normalizeImageDataUrl(attributes.get('src') ?? '')
      if (src !== null) output += `<img src="${src}">`
      continue
    }
    if (tag === 'font') {
      const attributes = parseAttributes(attributeText)
      const color =
        colorFromStyle(attributes.get('style') ?? '') ??
        normalizeCssColor(attributes.get('color') ?? '')
      if (color === null) {
        stack.push({ tag, emitted: false })
        continue
      }
      push({
        tag,
        emitted: true,
        open: `<span style="color: ${color}">`,
        closeTag: 'span',
      })
      continue
    }
    if (ALLOWED_TAG_SET.has(tag)) {
      const attributes = parseAttributes(attributeText)
      const style = sanitizeStyle(attributes.get('style') ?? '')
      if (tag === 'span' && style === '') {
        stack.push({ tag, emitted: false })
        continue
      }
      push({
        tag,
        emitted: true,
        open: style === '' ? `<${tag}>` : `<${tag} style="${style}">`,
        closeTag: tag,
      })
      continue
    }
    stack.push({ tag, emitted: false })
  }

  const tail = source.slice(index)
  if (tail !== '') output += escapeHtml(decodeEntities(tail))
  while (stack.length > 0) closeEntry(stack.pop())
  return output
}

/**
 * Strip dangerous markup and keep only the tags the editor itself produces.
 * @param html - untrusted HTML.
 * @returns sanitised HTML.
 */
export function sanitizeHtml(html) {
  if (html === null || html === undefined) return ''
  const source = String(html)
  if (source.trim() === '') return ''
  const Parser = typeof globalThis === 'undefined' ? undefined : globalThis.DOMParser
  if (typeof Parser === 'function') {
    try {
      return sanitizeWithDom(source, Parser)
    } catch {
      // A broken DOMParser must never take the note down: use the tokenizer.
    }
  }
  return sanitizeFallback(source)
}

/**
 * Collapse whitespace for display-oriented plain text.
 * @param text - raw text.
 * @returns normalised text.
 */
function normalizePlainText(text) {
  return String(text ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Extract readable text from HTML. Used for word counts; the caller decides
 * whether whitespace counts (the editor strips it before counting).
 * @param html - HTML string.
 * @returns plain text with collapsed whitespace and line breaks preserved.
 */
export function htmlToPlainText(html) {
  const safe = sanitizeHtml(html)
  if (safe === '') return ''
  const text = safe
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|blockquote|pre|ul|ol)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
  return normalizePlainText(decodeEntities(text))
}
