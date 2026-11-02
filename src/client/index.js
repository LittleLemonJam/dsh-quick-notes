/**
 * Client entry: register styles, locale, the notes store and both slots.
 *
 * The floating window lives in `shell.overlay` (a frame-wide, click-through
 * layer); the sidebar footer action is the always-reachable launcher. Both
 * components read the same store instance created here, so window state and
 * sidebar state never diverge.
 */
import { h } from './dom.js'
import { App, ErrorBoundary } from './app.js'
import { Launcher } from './launcher.js'
import { CSS } from './styles.js'
import { NS, registerLocale } from './i18n.js'
import { createNotesStore } from './store.js'
import { createStorage } from './storage.js'
import { installErrorReporting } from './diagnostics.js'

/** Slot ids owned by this plugin. */
const OVERLAY_SLOT_ID = 'quick-notes-window'
const LAUNCHER_SLOT_ID = 'quick-notes-launcher'

/**
 * Build the plugin object the DSH Client loader mounts.
 * @returns the Client plugin definition.
 */
export function createPlugin() {
  return {
    inject: ['slots', 'locale'],
    apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-quick-notes')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'dsh-quick-notes: styles')

      ctx.effect(() => registerLocale(ctx), 'dsh-quick-notes: locale')

      ctx.effect(() => installErrorReporting(), 'dsh-quick-notes: error reporting')

      const storage = createStorage()
      const store = createNotesStore({ storage })
      ctx.effect(() => {
        void store.start()
        return () => store.dispose()
      }, 'dsh-quick-notes: store')

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: OVERLAY_SLOT_ID,
            order: 60,
            locale: NS,
          },
          (props) => h(ErrorBoundary, { t: props.t }, h(App, { ...props, store })),
        ),
      )

      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: LAUNCHER_SLOT_ID,
            order: 5,
            locale: NS,
          },
          (props) => h(Launcher, { ...props, store }),
        ),
      )
    },
  }
}
