/**
 * Sidebar footer launcher.
 *
 * The floating window can be hidden; this button is the permanent way back.
 * It sits beside Settings at the sidebar foot and follows the host's icon
 * button treatment.
 */
import { h } from './dom.js'
import { useStoreState } from './store.js'

/** Localized copy. */
export const I18N = {
  en: {
    'app.launcher': 'Quick notes',
    'app.show': 'Show quick notes',
    'app.hide': 'Hide quick notes',
    'app.crash':
      'Quick notes failed to render. Reload the page; details were written to the plugin diagnostic log.',
  },
  zh: {
    'app.launcher': '随想随记',
    'app.show': '显示随想随记',
    'app.hide': '隐藏随想随记',
    'app.crash': '随想随记渲染失败。请刷新页面；详细信息已写入插件诊断日志。',
  },
}

/** Component styles. */
export const CSS = `
.qn-launcher {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  transition: background 120ms ease, color 120ms ease;
}

.qn-launcher:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}

.qn-launcher[aria-pressed='true'] {
  color: var(--dsw-alias-brand-primary);
}

.qn-launcher .qn-icon {
  width: 18px;
  height: 18px;
}
`

/**
 * Note glyph shared by the launcher and the minimized ball.
 * @param props - `size` in pixels.
 * @returns the SVG element.
 */
export function noteGlyph({ size = 18 } = {}) {
  return h(
    'svg',
    {
      className: 'qn-icon',
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.7,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    h('path', {
      d: 'M6 3.5h8.5L19 8v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1-1.5Z',
    }),
    h('path', { d: 'M14 3.5V8h4.5' }),
    h('path', { d: 'M8.5 12.5h7M8.5 16h4.5' }),
  )
}

/**
 * Sidebar footer toggle.
 * @param props - slot props plus the notes store.
 * @returns the button element.
 */
export function Launcher({ t, store }) {
  const state = useStoreState(store)
  const visible = state.ui.mode !== 'hidden'
  const label = visible ? t('app.hide') : t('app.show')
  return h(
    'button',
    {
      type: 'button',
      className: 'qn-launcher',
      title: label,
      'aria-label': label,
      'aria-pressed': visible,
      'data-qn-launcher': 'true',
      onClick: () => store.actions.setMode(visible ? 'hidden' : 'normal'),
    },
    noteGlyph({ size: 18 }),
  )
}
