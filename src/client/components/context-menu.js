/**
 * Right-click format menu.
 *
 * Rendered by `editor.js` at the pointer position when the selection is not
 * collapsed. The menu is `position: fixed` and clamps itself to the viewport.
 * `mousedown` on the menu is always prevented so the editor selection (and the
 * caret) survive clicking a command; global listeners (outside click, Escape,
 * scroll, resize) close it again.
 *
 * The menu only offers clipboard actions (copy / cut / paste) and
 * clear-formatting; the commands themselves live in `format.js`. The saved
 * selection is restored first through the `onBeforeAction` callback supplied by
 * the editor, and a denied clipboard permission keeps the menu open with a
 * visible status line instead of looking like a silent no-op.
 */
import React from 'react'
import { clamp, h } from '../dom.js'
import { clearFormat, copySelection, cutSelection, pasteAtCaret } from './format.js'

/** Localized copy. */
export const I18N = {
  en: {
    'menu.ariaLabel': 'Formatting menu',
    'menu.copy': 'Copy',
    'menu.cut': 'Cut',
    'menu.paste': 'Paste',
    'menu.clear': 'Clear formatting',
    'menu.clipboardFailed': 'Clipboard unavailable — check the browser permission.',
  },
  zh: {
    'menu.ariaLabel': '格式菜单',
    'menu.copy': '复制',
    'menu.cut': '剪切',
    'menu.paste': '粘贴',
    'menu.clear': '清除格式',
    'menu.clipboardFailed': '剪贴板不可用，请检查浏览器权限。',
  },
}

/** Component styles. */
export const CSS = `
.qn-menu {
  position: fixed;
  z-index: 80;
  min-width: 196px;
  max-height: calc(100vh - 16px);
  overflow: auto;
  padding: 6px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 1.4;
  user-select: none;
  -webkit-user-select: none;
}

.qn-menu-separator {
  height: 1px;
  margin: 4px 6px;
  background: var(--dsw-alias-border-l1);
}

.qn-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  text-align: left;
  color: var(--dsw-alias-label-primary);
}

.qn-menu-item:hover {
  background: var(--dsw-alias-bg-layer-2);
}

.qn-menu-item:disabled {
  opacity: 0.5;
  cursor: default;
}

.qn-menu-item:disabled:hover {
  background: transparent;
}

.qn-menu-status {
  margin-top: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 1.5;
}
`

/** Gap kept between the menu and the viewport edges, in CSS pixels. */
const VIEWPORT_MARGIN = 8

/**
 * Menu entries, in render order.
 *
 * `clipboard: true` marks commands that go through the asynchronous Clipboard
 * API and can fail (permission denied): the menu then stays open and shows
 * `menu.clipboardFailed`. `divider: true` draws a separator above the entry.
 */
const MENU_ITEMS = Object.freeze([
  { action: 'copy', label: 'menu.copy', run: copySelection, clipboard: true },
  { action: 'cut', label: 'menu.cut', run: cutSelection, clipboard: true },
  { action: 'paste', label: 'menu.paste', run: pasteAtCaret, clipboard: true },
  { action: 'clear', label: 'menu.clear', run: clearFormat, clipboard: false, divider: true },
])

/**
 * Render the format menu.
 * @param props - `t`, pointer `x`/`y`, the `editor` element, `onBeforeAction`
 *   (restore the saved selection) and `onClose`.
 * @returns the menu element.
 */
export function ContextMenu({ t, x, y, editor, onBeforeAction, onClose }) {
  const menuRef = React.useRef(null)
  const [position, setPosition] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState(null)

  // Measure the menu once, then clamp it inside the viewport.
  React.useLayoutEffect(() => {
    const menu = menuRef.current
    if (menu === null) return
    const view = menu.ownerDocument?.defaultView ?? null
    const viewportWidth = view?.innerWidth ?? 0
    const viewportHeight = view?.innerHeight ?? 0
    const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - menu.offsetWidth - VIEWPORT_MARGIN)
    const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - menu.offsetHeight - VIEWPORT_MARGIN)
    setPosition({
      left: Math.round(clamp(x, VIEWPORT_MARGIN, maxLeft)),
      top: Math.round(clamp(y, VIEWPORT_MARGIN, maxTop)),
    })
  }, [x, y])

  // Close on outside click, Escape, scroll and resize; every listener is removed
  // when the menu unmounts (or its owner changes).
  React.useEffect(() => {
    const menu = menuRef.current
    const document = menu?.ownerDocument ?? null
    if (document === null) return undefined
    const handlePointerDown = (event) => {
      if (menu !== null && menu.contains(event.target)) return
      onClose()
    }
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    const handleScroll = (event) => {
      // Scrolling inside the menu itself must not close it.
      if (menu !== null && event.target !== null && menu.contains(event.target)) return
      onClose()
    }
    const handleResize = () => onClose()
    document.addEventListener('mousedown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('scroll', handleScroll, true)
    document.defaultView?.addEventListener('resize', handleResize)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('scroll', handleScroll, true)
      document.defaultView?.removeEventListener('resize', handleResize)
    }
  }, [onClose])

  /**
   * Restore the saved selection, then run one menu command.
   *
   * Synchronous commands close the menu afterwards; clipboard commands keep it
   * open while they wait and only close on success, so a denied permission is
   * visible instead of looking like a click that did nothing.
   *
   * @param item - entry from {@link MENU_ITEMS}.
   */
  const execute = async (item) => {
    const target = editor
    if (target === null || target === undefined) {
      onClose()
      return
    }
    if (typeof onBeforeAction === 'function') onBeforeAction()
    if (!item.clipboard) {
      try {
        item.run(target)
      } finally {
        onClose()
      }
      return
    }
    setBusy(true)
    try {
      const succeeded = await item.run(target)
      setBusy(false)
      if (succeeded === false) {
        setStatus(t('menu.clipboardFailed'))
        return
      }
      onClose()
    } catch {
      setBusy(false)
      setStatus(t('menu.clipboardFailed'))
    }
  }

  const renderItem = (item) =>
    h(
      'button',
      {
        key: item.action,
        type: 'button',
        className: 'qn-menu-item',
        role: 'menuitem',
        disabled: busy,
        'data-qn-menu-action': item.action,
        onClick: () => void execute(item),
      },
      t(item.label),
    )

  const items = MENU_ITEMS.flatMap((item) => {
    if (item.divider !== true) return [renderItem(item)]
    return [
      h('div', { key: `${item.action}-divider`, className: 'qn-menu-separator', role: 'none' }),
      renderItem(item),
    ]
  })

  const style = position === null ? { left: x, top: y, visibility: 'hidden' } : position

  return h(
    'div',
    {
      ref: menuRef,
      className: 'qn-menu',
      style,
      role: 'menu',
      'aria-label': t('menu.ariaLabel'),
      'data-qn-menu': 'true',
      onMouseDown: (event) => event.preventDefault(),
      onContextMenu: (event) => event.preventDefault(),
    },
    items,
    status === null
      ? null
      : h(
          'div',
          {
            className: 'qn-menu-status',
            role: 'status',
            'data-qn-menu-status': 'true',
          },
          status,
        ),
  )
}
