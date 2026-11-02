/**
 * Tiny DOM/React helpers shared by Client components.
 *
 * This module has no side effects: it only wraps React's factory and a few
 * pure utility functions so every component renders through the same `h`.
 */
import React from 'react'

/** React element factory (the Client build does not use JSX). */
export const h = React.createElement

/** React fragment shorthand. */
export const Fragment = React.Fragment

/**
 * Join truthy class names.
 * @param parts - class names, false/null/undefined are dropped.
 * @returns the joined class attribute.
 */
export function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}

/**
 * Clamp a number into an inclusive range.
 * @param value - candidate value.
 * @param min - lower bound.
 * @param max - upper bound.
 * @returns the clamped value.
 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** Fallback viewport used outside a browser (unit tests, pre-mount). */
const FALLBACK_VIEWPORT = Object.freeze({ width: 1280, height: 800 })

/**
 * Read the layout viewport every geometry decision should use.
 *
 * `documentElement.clientWidth/Height` excludes the page scrollbar, so a window
 * clamped with this value is exactly the area the overlay can paint in. The
 * store, the window chrome and the minimized ball all read the viewport through
 * this helper, which keeps their clamp results consistent.
 *
 * @returns `{ width, height }` in CSS pixels.
 */
export function currentViewport() {
  if (typeof window === 'undefined') return { ...FALLBACK_VIEWPORT }
  const root = typeof document === 'undefined' ? null : document.documentElement
  return {
    width: Math.max(320, Math.round(root?.clientWidth || window.innerWidth || 1280)),
    height: Math.max(240, Math.round(root?.clientHeight || window.innerHeight || 800)),
  }
}

/**
 * Format a count for compact badges: 1..999 as-is, larger as "1.2k".
 * @param value - non-negative number.
 * @returns display text.
 */
export function formatCount(value) {
  const count = Math.max(0, Math.floor(Number(value) || 0))
  if (count < 1000) return String(count)
  return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

/**
 * Trigger a browser download for a JSON payload.
 * @param filename - suggested file name.
 * @param value - JSON-serialisable value.
 */
export function downloadJson(filename, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  // A detached anchor click is supported by the Chromium shell; avoiding the
  // document.body write keeps every plugin DOM node inside its own React tree.
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Open a file picker and read the chosen file as text.
 * @param accept - input accept attribute.
 * @returns the file text, or null when the user cancels.
 */
export function pickTextFile(accept = 'application/json,.json') {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(value)
    }
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (file === undefined) {
        finish(null)
        return
      }
      file.text().then(finish, () => finish(null))
    })
    input.addEventListener('cancel', () => finish(null))
    input.click()
  })
}
