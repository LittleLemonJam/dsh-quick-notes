/**
 * Application composition root.
 *
 * `App` owns the choice between the floating window, the minimized ball and
 * the hidden state, and lays out the directory / divider / editor body. The
 * chrome itself lives in components/window.js, the directory in
 * components/sidebar.js and the editor in components/editor.js.
 */
import React from 'react'
import { clamp, h } from './dom.js'
import { useStoreState } from './store.js'
import { findNote, SIDEBAR_LIMITS } from '../shared/model.js'
import { reportDiagnostic } from './diagnostics.js'
import { resolvePluginTheme, useHostTheme } from './theme.js'
import { WindowFrame } from './components/window.js'
import { MinimizedBall } from './components/ball.js'
import { Sidebar } from './components/sidebar.js'
import { NoteEditor } from './components/editor.js'

/** Build marker reported by the mount ping; matches the released version. */
const CLIENT_BUILD = '1.0.0'

/**
 * Catch render failures so a bug in one component cannot blank the overlay,
 * and leave evidence in the Host diagnostic log.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    reportDiagnostic('render.error', {
      message: String(error?.message ?? error),
      stack: typeof error?.stack === 'string' ? error.stack : '',
      componentStack: typeof info?.componentStack === 'string' ? info.componentStack : '',
    })
  }

  render() {
    if (this.state.failed) {
      const t = this.props.t
      return h(
        'div',
        { className: 'qn-root' },
        h('div', { className: 'qn-crash', role: 'alert' }, t('app.crash')),
      )
    }
    return this.props.children
  }
}

/**
 * Draggable divider between the directory and the editor.
 * @param props - current state and the store actions.
 * @returns the divider element.
 */
function SidebarDivider({ state, actions }) {
  const dragging = React.useRef(false)

  const stop = (event) => {
    dragging.current = false
    event.currentTarget.dataset.dragging = 'false'
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return h('div', {
    className: 'qn-divider',
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': 'resize directory',
    'data-qn-divider': 'true',
    'data-dragging': 'false',
    onPointerDown: (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      dragging.current = true
      event.currentTarget.dataset.dragging = 'true'
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: (event) => {
      if (!dragging.current) return
      const width = clamp(event.clientX - state.ui.rect.x, SIDEBAR_LIMITS.min, SIDEBAR_LIMITS.max)
      actions.updateUi({ sidebarWidth: Math.round(width) })
    },
    onPointerUp: stop,
    onPointerCancel: stop,
  })
}

/**
 * Mount the floating notes UI.
 * @param props - slot props (`t`) plus the notes store.
 * @returns the overlay content, or null while hidden.
 */
export function App({ t, store }) {
  const state = useStoreState(store)
  const hostTheme = useHostTheme()
  const actions = store.actions
  const theme = resolvePluginTheme(state.settings.theme, hostTheme)
  const rootProps = { className: 'qn-root', 'data-qn-theme': theme, 'data-qn-mode': state.ui.mode }

  // One mount ping proves to a maintainer that the overlay actually rendered;
  // the Host log is the only observable channel in a headless deployment.
  React.useEffect(() => {
    reportDiagnostic('mounted', {
      version: typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : 'dev',
      build: CLIENT_BUILD,
      mode: state.ui.mode,
      theme,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only ping
  }, [])

  // Report the resolved palette on every change, so a live check can confirm
  // that a pinned theme really ignores the host theme.
  React.useEffect(() => {
    reportDiagnostic('theme', {
      theme,
      preference: state.settings.theme,
      hostTheme,
    })
  }, [theme, state.settings.theme, hostTheme])

  if (state.ui.mode === 'hidden') return null

  if (state.ui.mode === 'ball') {
    return h('div', rootProps, h(MinimizedBall, { t, state, actions }))
  }

  const note = state.activeId === null ? null : (findNote(state, state.activeId) ?? null)
  const editor = h(NoteEditor, { t, state, actions, note })
  const body =
    state.ui.mode === 'compact'
      ? h('div', { className: 'qn-body qn-body-compact' }, editor)
      : h(
          'div',
          { className: 'qn-body' },
          h(Sidebar, { t, state, actions }),
          h(SidebarDivider, { state, actions }),
          editor,
        )

  return h('div', rootProps, h(WindowFrame, { t, state, actions }, body))
}
