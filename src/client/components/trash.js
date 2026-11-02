/**
 * Recycle bin panel + the panel primitives shared by the directory column.
 *
 * `TrashPanel` lists soft-deleted notes with a relative deletion time, restore,
 * delete-forever and empty-the-bin actions. The directory column renders two
 * panels (this one and the settings panel) and an empty state, so the building
 * blocks they all need live here in the leaf module: `icon`, `panelHead`,
 * `textButton`, the two-step confirmation state machine and the relative-time
 * formatter. Nothing here imports a sibling component, therefore
 * `settings.js` and `sidebar.js` can share these helpers without a cycle.
 */
import React from 'react'
import { cx, h } from '../dom.js'

/** How long an armed destructive action waits for the second click, in ms. */
export const CONFIRM_RESET_MS = 3000

/** Pseudo id used by the "empty the recycle bin" confirmation. */
const EMPTY_TRASH_CONFIRM_ID = 'trash:empty'

/** Duration units used by `formatRelativeTime`. */
const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const MONTH_MS = 30 * DAY_MS
const YEAR_MS = 365 * DAY_MS

/** Relative-time translation keys, from the shortest to the longest span. */
const RELATIVE_TIME_KEYS = Object.freeze({
  unknown: 'trash.timeUnknown',
  justNow: 'trash.timeJustNow',
  minutes: 'trash.timeMinutesAgo',
  hours: 'trash.timeHoursAgo',
  days: 'trash.timeDaysAgo',
  months: 'trash.timeMonthsAgo',
  years: 'trash.timeYearsAgo',
})

/** Localized copy. */
export const I18N = {
  en: {
    'trash.title': 'Recycle bin',
    'trash.back': 'Back to notes',
    'trash.empty': 'The recycle bin is empty.',
    'trash.restore': 'Restore',
    'trash.purge': 'Delete forever',
    'trash.purgeConfirm': 'Confirm delete?',
    'trash.emptyAction': 'Empty recycle bin',
    'trash.emptyConfirm': 'Confirm empty?',
    'trash.timeUnknown': 'unknown time',
    'trash.timeJustNow': 'just now',
    'trash.timeMinutesAgo': '{n} min ago',
    'trash.timeHoursAgo': '{n} h ago',
    'trash.timeDaysAgo': '{n} d ago',
    'trash.timeMonthsAgo': '{n} mo ago',
    'trash.timeYearsAgo': '{n} y ago',
  },
  zh: {
    'trash.title': '回收站',
    'trash.back': '返回便签',
    'trash.empty': '回收站是空的。',
    'trash.restore': '还原',
    'trash.purge': '彻底删除',
    'trash.purgeConfirm': '确认删除？',
    'trash.emptyAction': '清空回收站',
    'trash.emptyConfirm': '确认清空？',
    'trash.timeUnknown': '时间未知',
    'trash.timeJustNow': '刚刚',
    'trash.timeMinutesAgo': '{n} 分钟前',
    'trash.timeHoursAgo': '{n} 小时前',
    'trash.timeDaysAgo': '{n} 天前',
    'trash.timeMonthsAgo': '{n} 个月前',
    'trash.timeYearsAgo': '{n} 年前',
  },
}

/**
 * Component styles, one rule per line to keep the CSS-in-JS sheet compact.
 *
 * The panel shell and text buttons are shared by the settings panel and the
 * directory empty state; each of them is rendered inside the same column.
 */
export const CSS = `
/* Panel shell. */
.qn-panel { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.qn-panel-head { display: flex; align-items: center; gap: 4px; padding: 8px 8px 4px 6px; flex: none; }
.qn-panel-title { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qn-panel-body { display: flex; flex-direction: column; gap: 8px; flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 2px 10px 12px; }

/* Text button shared by every panel action. */
.qn-text-button { display: inline-flex; align-items: center; justify-content: center; height: 24px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; white-space: nowrap; transition: background 120ms ease, color 120ms ease, border-color 120ms ease; }
.qn-text-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.qn-text-button:disabled { opacity: 0.4; cursor: default; }
.qn-text-button-danger:hover:not(:disabled) { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); background: var(--dsw-alias-interactive-bg-hover-danger); }
.qn-text-button-armed, .qn-text-button-armed:hover:not(:disabled) { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }

/* Deleted note rows. */
.qn-trash-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.qn-trash-item { display: flex; flex-direction: column; gap: 5px; padding: 6px 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.qn-trash-item-head { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.qn-trash-title { font-size: 12px; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qn-trash-time { font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.qn-trash-item-actions { display: flex; align-items: center; gap: 4px; }
.qn-trash-item-actions .qn-text-button { height: 22px; padding: 0 8px; font-size: 11px; }
.qn-trash-empty { margin: 0; padding: 16px 4px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.6; }
.qn-trash-clear { margin-top: auto; align-self: stretch; }
`

/**
 * Build one inline stroke icon.
 * @param children - SVG children.
 * @returns the SVG element.
 */
export function icon(children) {
  return h(
    'svg',
    {
      // Stable key: the recycle-bin button renders the icon in an array next to
      // its count badge.
      key: 'icon',
      className: 'qn-icon',
      width: 16,
      height: 16,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    children,
  )
}

/** Back arrow glyph. */
function backGlyph() {
  return icon([h('path', { key: 'back', d: 'M15 5l-7 7 7 7' })])
}

/**
 * Panel header shared by the trash and settings panels.
 * @param options - title, back-button label, click handler and data hook.
 * @returns the header element.
 */
export function panelHead({ title, backLabel, onBack, backData }) {
  return h(
    'div',
    { className: 'qn-panel-head' },
    h(
      'button',
      {
        type: 'button',
        className: 'qn-icon-button qn-panel-back',
        title: backLabel,
        'aria-label': backLabel,
        'data-qn-back': backData,
        onClick: onBack,
      },
      backGlyph(),
    ),
    h('h2', { className: 'qn-panel-title' }, title),
  )
}

/**
 * Text button shared by the panel and footer actions.
 * @param options - `label` plus click handler, variants (`danger`/`armed`),
 * `disabled`, optional `title`, extra class and `data-*` attributes.
 * @returns the button element.
 */
export function textButton({
  label,
  onClick,
  danger = false,
  armed,
  disabled = false,
  title,
  className,
  data,
  children,
}) {
  return h(
    'button',
    {
      type: 'button',
      className: cx(
        'qn-text-button',
        danger && 'qn-text-button-danger',
        armed && 'qn-text-button-armed',
        className,
      ),
      title: title ?? label,
      'aria-label': label,
      'aria-pressed': armed,
      disabled,
      ...(data ?? {}),
      onClick,
    },
    children ?? label,
  )
}

/**
 * Bucket a timestamp into a relative-time translation descriptor.
 * @param timestamp - epoch milliseconds of the event.
 * @param now - current epoch milliseconds.
 * @returns translation key plus interpolation count.
 */
export function formatRelativeTime(timestamp, now = Date.now()) {
  const time = Number(timestamp)
  const current = Number(now)
  if (!Number.isFinite(time) || !Number.isFinite(current)) {
    return { key: RELATIVE_TIME_KEYS.unknown, n: 0 }
  }
  const elapsed = Math.max(0, current - time)
  if (elapsed < MINUTE_MS) return { key: RELATIVE_TIME_KEYS.justNow, n: 0 }
  if (elapsed < HOUR_MS) {
    return { key: RELATIVE_TIME_KEYS.minutes, n: Math.floor(elapsed / MINUTE_MS) }
  }
  if (elapsed < DAY_MS) {
    return { key: RELATIVE_TIME_KEYS.hours, n: Math.floor(elapsed / HOUR_MS) }
  }
  if (elapsed < MONTH_MS) {
    return { key: RELATIVE_TIME_KEYS.days, n: Math.floor(elapsed / DAY_MS) }
  }
  if (elapsed < YEAR_MS) {
    return { key: RELATIVE_TIME_KEYS.months, n: Math.floor(elapsed / MONTH_MS) }
  }
  return { key: RELATIVE_TIME_KEYS.years, n: Math.floor(elapsed / YEAR_MS) }
}

/**
 * Advance the two-step confirmation state machine.
 *
 * A first activation arms the given id; activating the same id again inside
 * `CONFIRM_RESET_MS` is the confirmation. Any other id, or a stale armed state,
 * simply arms the new id instead of executing anything.
 *
 * @param current - currently armed state, or null when idle.
 * @param id - id of the action the user just activated.
 * @param now - current epoch milliseconds.
 * @returns the next armed state; `confirmed` marks the executing click.
 */
export function nextConfirmState(current, id, now = Date.now()) {
  const armed =
    current !== null &&
    typeof current === 'object' &&
    current.id === id &&
    Number.isFinite(current.at) &&
    now - current.at < CONFIRM_RESET_MS
  return { id, at: now, confirmed: armed }
}

/**
 * React state for a two-step confirmation.
 * @param resetMs - delay after which an armed action disarms itself, in ms.
 * @returns pending state plus request / reset / query helpers.
 */
export function useTwoStepConfirm(resetMs = CONFIRM_RESET_MS) {
  const [pending, setPending] = React.useState(null)
  const timerRef = React.useRef(null)

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  React.useEffect(() => clearTimer, [])

  const reset = () => {
    clearTimer()
    setPending(null)
  }

  const requestConfirm = (id) => {
    const next = nextConfirmState(pending, id)
    clearTimer()
    if (next.confirmed) {
      setPending(null)
      return true
    }
    setPending({ id: next.id, at: next.at })
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setPending(null)
    }, resetMs)
    return false
  }

  return {
    pending,
    reset,
    requestConfirm,
    isPending: (id) => pending !== null && pending.id === id,
  }
}

/**
 * Render the recycle bin.
 * @param props - `t`, `state`, `actions`.
 * @returns the panel element.
 */
export function TrashPanel({ t, state, actions }) {
  const confirm = useTwoStepConfirm()
  const now = Date.now()
  const items = state.trash
  const emptyArmed = confirm.isPending(EMPTY_TRASH_CONFIRM_ID)

  const onRestore = (id) => {
    confirm.reset()
    actions.restoreNote(id)
  }

  const onPurge = (id) => {
    if (confirm.requestConfirm(id)) actions.purgeNote(id)
  }

  const onEmpty = () => {
    if (confirm.requestConfirm(EMPTY_TRASH_CONFIRM_ID)) actions.emptyTrash()
  }

  const renderItem = (note) => {
    const relative = formatRelativeTime(note.deletedAt, now)
    const armed = confirm.isPending(note.id)
    return h(
      'li',
      { key: note.id, className: 'qn-trash-item', 'data-qn-trash-id': note.id },
      h(
        'div',
        { className: 'qn-trash-item-head' },
        h('span', { className: 'qn-trash-title', title: note.title }, note.title),
        h('span', { className: 'qn-trash-time' }, t(relative.key, { n: relative.n })),
      ),
      h(
        'div',
        { className: 'qn-trash-item-actions' },
        textButton({ label: t('trash.restore'), onClick: () => onRestore(note.id) }),
        textButton({
          label: armed ? t('trash.purgeConfirm') : t('trash.purge'),
          danger: true,
          armed,
          data: { 'data-qn-purge': note.id },
          onClick: () => onPurge(note.id),
        }),
      ),
    )
  }

  const clearLabel = emptyArmed ? t('trash.emptyConfirm') : t('trash.emptyAction')

  return h(
    'div',
    { className: 'qn-panel qn-trash-panel', 'data-qn-panel': 'trash' },
    panelHead({
      title: t('trash.title'),
      backLabel: t('trash.back'),
      backData: 'trash',
      onBack: () => actions.setView('notes'),
    }),
    h(
      'div',
      { className: 'qn-panel-body' },
      items.length === 0
        ? h('p', { className: 'qn-trash-empty' }, t('trash.empty'))
        : h(
            'ul',
            { className: 'qn-trash-list', 'data-qn-trash-list': 'true' },
            items.map(renderItem),
          ),
      items.length > 0 &&
        textButton({
          label: clearLabel,
          danger: true,
          armed: emptyArmed,
          className: 'qn-trash-clear',
          data: { 'data-qn-empty-trash': 'true' },
          onClick: onEmpty,
        }),
    ),
  )
}
