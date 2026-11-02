/**
 * Theme independence for the floating notes surface.
 *
 * The plugin owns its palette (see `styles.js`), so it can follow the DeepSeek
 * Harness theme, or stay on a fixed light/dark palette while the host theme
 * changes. `themeFromDocument()` reads the host's painted background instead of
 * one private attribute, so it keeps working if the host changes how it applies
 * its palette; the attribute and the OS preference are only fallbacks.
 */
import React from 'react'

/** Attribute the host theme applies to `body` in current builds. */
const HOST_THEME_ATTRIBUTE = 'data-ds-dark-theme'

/** Relative luminance below this value counts as a dark surface. */
const DARK_LUMINANCE_THRESHOLD = 0.45

/**
 * Parse a computed `rgb()` / `rgba()` colour.
 * @param value - computed CSS colour string.
 * @returns `{ r, g, b, a }` in 0..255 / 0..1, or null when unparsable.
 */
function parseColor(value) {
  if (typeof value !== 'string') return null
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(
    value.trim(),
  )
  if (match === null) return null
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  }
}

/**
 * WCAG relative luminance of one colour.
 * @param color - parsed colour.
 * @returns luminance in 0..1.
 */
function relativeLuminance(color) {
  const channel = (value) => {
    const normalized = Math.min(1, Math.max(0, value / 255))
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

/**
 * Read the host theme from the document's painted surfaces.
 * @param doc - document to inspect (injectable for tests).
 * @returns `'light'` or `'dark'`.
 */
export function themeFromDocument(doc = typeof document === 'undefined' ? null : document) {
  if (doc === null || doc === undefined) return 'light'
  const view = doc.defaultView
  for (const element of [doc.body, doc.documentElement]) {
    if (element === null || element === undefined) continue
    let background = ''
    try {
      background = view?.getComputedStyle?.(element)?.backgroundColor ?? ''
    } catch {
      background = ''
    }
    const color = parseColor(background)
    if (color === null || color.a === 0) continue
    return relativeLuminance(color) < DARK_LUMINANCE_THRESHOLD ? 'dark' : 'light'
  }
  // The host attribute is authoritative when the painted surfaces are
  // transparent; an explicit "false" means the light palette.
  for (const element of [doc.body, doc.documentElement]) {
    if (element?.hasAttribute?.(HOST_THEME_ATTRIBUTE) === true) {
      return element.getAttribute(HOST_THEME_ATTRIBUTE) === 'false' ? 'light' : 'dark'
    }
  }
  try {
    return view?.matchMedia?.('(prefers-color-scheme: dark)')?.matches === true ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/**
 * Resolve the plugin palette from the user preference and the host theme.
 * @param preference - `'system'`, `'light'` or `'dark'`.
 * @param hostTheme - host theme when the preference is `'system'`.
 * @returns `'light'` or `'dark'`.
 */
export function resolvePluginTheme(preference, hostTheme) {
  return preference === 'light' || preference === 'dark' ? preference : hostTheme
}

/**
 * Observe host theme changes.
 * @param listener - called when the document's attributes or colour scheme change.
 * @param doc - document to observe.
 * @returns a disposer removing every observer.
 */
function subscribeHostTheme(listener, doc = typeof document === 'undefined' ? null : document) {
  if (doc === null || doc === undefined) return () => {}
  const view = doc.defaultView
  const Observer = view?.MutationObserver
  const observer = typeof Observer === 'function' ? new Observer(listener) : null
  if (observer !== null) {
    observer.observe(doc.documentElement, { attributes: true })
    if (doc.body !== null) observer.observe(doc.body, { attributes: true })
  }
  let media = null
  try {
    media = view?.matchMedia?.('(prefers-color-scheme: dark)') ?? null
  } catch {
    media = null
  }
  const onMediaChange = () => listener()
  media?.addEventListener?.('change', onMediaChange)
  return () => {
    observer?.disconnect()
    media?.removeEventListener?.('change', onMediaChange)
  }
}

/**
 * Subscribe a component to the host theme.
 * @returns `'light'` or `'dark'`.
 */
export function useHostTheme() {
  const [theme, setTheme] = React.useState(() => themeFromDocument())
  React.useEffect(() => {
    const update = () => setTheme(themeFromDocument())
    update()
    return subscribeHostTheme(update)
  }, [])
  return theme
}
