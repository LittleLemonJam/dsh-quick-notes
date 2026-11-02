/**
 * Settings panel (rendered inside the directory column).
 *
 * Appearance (font size / line height / theme / window position reset), data
 * export and import, sync status, version and the project link. The rows are
 * data-driven (`STEPPER_FIELDS`, `THEMES`) and share the panel shell, header
 * and buttons with the recycle bin (`components/trash.js`).
 *
 * Import is destructive (it replaces the whole notes state) and therefore uses
 * the shared two-step confirmation hook; the outcome is rendered from
 * translation keys, never assembled strings. The pure helpers
 * (`syncLabelKey`, `themeLabelKey`, `translatedMessage`, `describeMessage`,
 * `stepSetting`, `exportFileName`) are exported for unit tests.
 */
import React from 'react'
import { clamp, downloadJson, h, pickTextFile } from '../dom.js'
import { DEFAULT_SETTINGS, SETTINGS_LIMITS, THEMES } from '../../shared/model.js'
import { panelHead, textButton, useTwoStepConfirm } from './trash.js'

/** Version injected by scripts/build.mjs; "dev" in tests and unbundled builds. */
const VERSION = typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : 'dev'

/** Public project home shown in the About section. */
const PROJECT_URL = 'https://github.com/LittleLemonJam/dsh-quick-notes'

/** Id of the import confirmation in the shared two-step state machine. */
const IMPORT_CONFIRM_ID = 'settings:import'

/** Store code for an unusable import payload (`store.actions.importState`). */
const IMPORT_INVALID_CODE = 'invalid'

/** Translation keys for the sync phases in `state.sync.phase`. */
export const SYNC_LABEL_KEYS = Object.freeze({
  loading: 'sync.loading',
  local: 'sync.local',
  syncing: 'sync.syncing',
  synced: 'sync.synced',
  error: 'sync.error',
})

/** Key used when a phase is missing or unknown (the product falls back to local). */
const SYNC_FALLBACK_KEY = 'sync.local'

/** Translation keys for the theme options in `settings.theme`. */
export const THEME_LABEL_KEYS = Object.freeze({
  system: 'settings.themeSystem',
  light: 'settings.themeLight',
  dark: 'settings.themeDark',
})

/**
 * Appearance rows rendered as numeric steppers, in display order.
 * `format` receives the current settings and returns the value to display.
 */
const STEPPER_FIELDS = Object.freeze([
  {
    setting: 'fontSize',
    labelId: 'qn-font-size-label',
    labelKey: 'settings.fontSize',
    decreaseKey: 'settings.fontSizeDecrease',
    increaseKey: 'settings.fontSizeIncrease',
    limits: SETTINGS_LIMITS.fontSize,
    format: (settings) => String(settings.fontSize),
  },
  {
    setting: 'lineHeight',
    labelId: 'qn-line-height-label',
    labelKey: 'settings.lineHeight',
    decreaseKey: 'settings.lineHeightDecrease',
    increaseKey: 'settings.lineHeightIncrease',
    limits: SETTINGS_LIMITS.lineHeight,
    format: (settings) => settings.lineHeight.toFixed(2),
  },
])

/** Localized copy. */
export const I18N = {
  en: {
    'settings.title': 'Settings',
    'settings.back': 'Back to notes',
    'settings.appearance': 'Appearance',
    'settings.fontSize': 'Font size',
    'settings.fontSizeDecrease': 'Decrease font size',
    'settings.fontSizeIncrease': 'Increase font size',
    'settings.lineHeight': 'Line height',
    'settings.lineHeightDecrease': 'Decrease line height',
    'settings.lineHeightIncrease': 'Increase line height',
    'settings.theme': 'Theme',
    'settings.themeSystem': 'System',
    'settings.themeLight': 'Light',
    'settings.themeDark': 'Dark',
    'settings.resetPosition': 'Reset window position',
    'settings.data': 'Data',
    'settings.export': 'Export JSON',
    'settings.exportSuccess': 'Exported the current notes.',
    'settings.exportFailed': 'Export failed.',
    'settings.import': 'Import JSON',
    'settings.importConfirm': 'Confirm import?',
    'settings.importInvalid': 'That file is not a valid notes backup.',
    'settings.importSuccess': 'Notes imported.',
    'settings.importFailed': 'Import failed.',
    'settings.importFailedDetail': 'Import failed: {reason}',
    'settings.sync': 'Sync',
    'settings.about': 'About',
    'settings.version': 'Version',
    'settings.project': 'GitHub repository',
    'sync.loading': 'Connecting…',
    'sync.local': 'Local only',
    'sync.syncing': 'Saving…',
    'sync.synced': 'Saved',
    'sync.error': 'Sync failed',
    'sync.host': 'The local notes file is unavailable; changes are kept in this browser.',
  },
  zh: {
    'settings.title': '设置',
    'settings.back': '返回便签',
    'settings.appearance': '外观',
    'settings.fontSize': '字号',
    'settings.fontSizeDecrease': '减小字号',
    'settings.fontSizeIncrease': '增大字号',
    'settings.lineHeight': '行高',
    'settings.lineHeightDecrease': '减小行高',
    'settings.lineHeightIncrease': '增大行高',
    'settings.theme': '主题',
    'settings.themeSystem': '跟随系统',
    'settings.themeLight': '浅色',
    'settings.themeDark': '深色',
    'settings.resetPosition': '恢复默认位置',
    'settings.data': '数据',
    'settings.export': '导出 JSON',
    'settings.exportSuccess': '已导出当前便签。',
    'settings.exportFailed': '导出失败。',
    'settings.import': '导入 JSON',
    'settings.importConfirm': '确认导入？',
    'settings.importInvalid': '该文件不是有效的便签备份。',
    'settings.importSuccess': '便签已导入。',
    'settings.importFailed': '导入失败。',
    'settings.importFailedDetail': '导入失败：{reason}',
    'settings.sync': '同步',
    'settings.about': '关于',
    'settings.version': '版本',
    'settings.project': 'GitHub 仓库',
    'sync.loading': '正在连接…',
    'sync.local': '仅保存在本地',
    'sync.syncing': '正在保存…',
    'sync.synced': '已保存',
    'sync.error': '同步失败',
    'sync.host': '本地便签文件暂不可用，修改已保存在当前浏览器中。',
  },
}

/** Component styles, one rule per line to keep the CSS-in-JS sheet compact. */
export const CSS = `
.qn-settings-section { display: flex; flex-direction: column; gap: 2px; }
.qn-settings-section + .qn-settings-section { margin-top: 6px; }
.qn-settings-heading { margin: 0 0 2px; font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-tertiary); }
.qn-setting-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 26px; }
.qn-setting-label { color: var(--dsw-alias-label-secondary); font-size: 12px; min-width: 0; }
.qn-stepper { display: flex; align-items: center; gap: 2px; flex: none; }
.qn-stepper-button { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 5px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1; }
.qn-stepper-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.qn-stepper-button:disabled { opacity: 0.4; cursor: default; }
.qn-setting-value { min-width: 34px; text-align: center; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
.qn-setting-block { display: flex; flex-direction: column; gap: 4px; }
.qn-segmented { display: flex; align-items: stretch; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; overflow: hidden; }
.qn-segment { flex: 1 1 0; min-width: 0; height: 24px; padding: 0 4px; border-radius: 0; color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qn-segment + .qn-segment { border-left: 1px solid var(--dsw-alias-border-l2); }
.qn-segment:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.qn-segment[aria-pressed='true'] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); color: var(--dsw-alias-label-primary); }
.qn-settings-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.qn-settings-notice { margin: 2px 0 0; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.qn-settings-notice[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.qn-settings-notice[data-tone='success'] { color: var(--dsw-alias-state-success-primary); }
.qn-settings-sync { margin: 2px 0 0; font-size: 12px; color: var(--dsw-alias-label-primary); }
.qn-settings-meta { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.qn-settings-meta-row { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.qn-settings-link { color: var(--dsw-alias-link); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qn-settings-link:hover { text-decoration: underline; }
`

/**
 * Translation key describing one sync phase.
 * @param phase - `state.sync.phase` value.
 * @returns the translation key for that phase.
 */
export function syncLabelKey(phase) {
  return SYNC_LABEL_KEYS[phase] ?? SYNC_FALLBACK_KEY
}

/**
 * Translation key for one theme option.
 * @param theme - `settings.theme` value.
 * @returns the translation key for that theme.
 */
export function themeLabelKey(theme) {
  return THEME_LABEL_KEYS[theme] ?? THEME_LABEL_KEYS.system
}

/**
 * Translate an optional store-supplied message.
 *
 * Store messages are translation keys (docs/architecture.md §4), so a value is
 * only treated as one when the translator actually resolves it; internal codes
 * such as `host` are dropped instead of leaking into the UI.
 *
 * @param t - translation function.
 * @param message - raw message from the store, if any.
 * @returns the translated text, or null when there is nothing translatable.
 */
export function translatedMessage(t, message) {
  if (typeof message !== 'string') return null
  const key = message.trim()
  if (key === '' || !key.includes('.')) return null
  const translated = t(key)
  return typeof translated === 'string' && translated !== '' && translated !== key
    ? translated
    : null
}

/**
 * Resolve a store-supplied diagnostic message for display.
 * @param t - translation function.
 * @param message - raw message from the store, if any.
 * @returns display text, or null when there is nothing to show.
 */
export function describeMessage(t, message) {
  if (typeof message !== 'string') return null
  const text = message.trim()
  if (text === '') return null
  return translatedMessage(t, text) ?? text
}

/**
 * Step a numeric setting by one increment, rounded to two decimals and clamped.
 * @param value - current value.
 * @param delta - direction: -1 or 1.
 * @param limits - `{ min, max, step }` bounds for that setting.
 * @returns the next value.
 */
export function stepSetting(value, delta, limits) {
  const current = Number.isFinite(value) ? value : limits.min
  const stepped = current + delta * limits.step
  return clamp(Math.round(stepped * 100) / 100, limits.min, limits.max)
}

/** Pad a date part to two digits. */
function pad2(value) {
  return String(value).padStart(2, '0')
}

/**
 * Export file name, e.g. `quick-notes-2026-11-01.json`.
 * @param now - date used for the stamp.
 * @returns the suggested file name.
 */
export function exportFileName(now = new Date()) {
  const date = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date()
  const stamp = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  return `quick-notes-${stamp}.json`
}

/**
 * Render the settings panel.
 * @param props - `t`, `state`, `actions`.
 * @returns the panel element.
 */
export function SettingsPanel({ t, state, actions }) {
  const settings = state.settings ?? DEFAULT_SETTINGS
  const confirm = useTwoStepConfirm()
  const [notice, setNotice] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const importArmed = confirm.isPending(IMPORT_CONFIRM_ID)
  const themeValue = settings.theme ?? 'system'
  const phase = state.sync?.phase ?? 'local'
  const syncDetail = translatedMessage(t, state.sync?.message)

  /** Patch one settings field. */
  const update = (patch) => actions.updateSettings(patch)

  /** Move one numeric setting by one step. */
  const stepField = (field, delta) => {
    const next = stepSetting(settings[field.setting], delta, field.limits)
    if (next !== settings[field.setting]) update({ [field.setting]: next })
  }

  const onExport = () => {
    try {
      downloadJson(exportFileName(new Date()), actions.exportState())
      setNotice({ tone: 'success', key: 'settings.exportSuccess' })
    } catch {
      setNotice({ tone: 'error', key: 'settings.exportFailed' })
    }
  }

  /**
   * Translate an `importState` result into a notice descriptor.
   * @param result - `{ ok, message? }` from the store.
   * @returns the notice to render.
   */
  const failureNotice = (result) => {
    if (result?.message === IMPORT_INVALID_CODE) {
      return { tone: 'error', key: 'settings.importInvalid' }
    }
    const reason = describeMessage(t, result?.message)
    return reason === null
      ? { tone: 'error', key: 'settings.importFailed' }
      : { tone: 'error', key: 'settings.importFailedDetail', params: { reason } }
  }

  const runImport = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const text = await pickTextFile()
      if (text === null) return
      let raw
      try {
        raw = JSON.parse(text)
      } catch {
        setNotice({ tone: 'error', key: 'settings.importInvalid' })
        return
      }
      const result = actions.importState(raw)
      if (result !== null && typeof result === 'object' && result.ok === true) {
        setNotice({ tone: 'success', key: 'settings.importSuccess' })
        // The store returns to the notes view on import; stay on settings so the
        // success notice (and the imported preferences) stay visible.
        actions.setView('settings')
        return
      }
      setNotice(failureNotice(result))
    } catch {
      setNotice({ tone: 'error', key: 'settings.importFailed' })
    } finally {
      setBusy(false)
    }
  }

  const onImport = () => {
    if (confirm.requestConfirm(IMPORT_CONFIRM_ID)) void runImport()
  }

  /** One labelled section row. */
  const section = (headingKey, ...children) =>
    h(
      'section',
      { className: 'qn-settings-section' },
      h('h3', { className: 'qn-settings-heading' }, t(headingKey)),
      ...children,
    )

  /** One numeric setting row (label + stepper). */
  const stepperRow = (field) => {
    const value = settings[field.setting]
    const decreaseLabel = t(field.decreaseKey)
    const increaseLabel = t(field.increaseKey)
    return h(
      'div',
      { key: field.setting, className: 'qn-setting-row' },
      h('span', { className: 'qn-setting-label', id: field.labelId }, t(field.labelKey)),
      h(
        'div',
        { className: 'qn-stepper', role: 'group', 'aria-labelledby': field.labelId },
        h(
          'button',
          {
            type: 'button',
            className: 'qn-stepper-button',
            title: decreaseLabel,
            'aria-label': decreaseLabel,
            disabled: value <= field.limits.min,
            onClick: () => stepField(field, -1),
          },
          h('span', { 'aria-hidden': 'true' }, '−'),
        ),
        h('output', { className: 'qn-setting-value' }, field.format(settings)),
        h(
          'button',
          {
            type: 'button',
            className: 'qn-stepper-button',
            title: increaseLabel,
            'aria-label': increaseLabel,
            disabled: value >= field.limits.max,
            onClick: () => stepField(field, 1),
          },
          h('span', { 'aria-hidden': 'true' }, '+'),
        ),
      ),
    )
  }

  /** Three-way theme picker. */
  const themeRow = h(
    'div',
    { className: 'qn-setting-block' },
    h('span', { className: 'qn-setting-label', id: 'qn-theme-label' }, t('settings.theme')),
    h(
      'div',
      { className: 'qn-segmented', role: 'group', 'aria-labelledby': 'qn-theme-label' },
      THEMES.map((theme) => {
        const label = t(themeLabelKey(theme))
        return h(
          'button',
          {
            key: theme,
            type: 'button',
            className: 'qn-segment',
            title: label,
            'aria-label': label,
            'aria-pressed': themeValue === theme,
            'data-qn-theme': theme,
            onClick: () => {
              if (themeValue !== theme) update({ theme })
            },
          },
          label,
        )
      }),
    ),
  )

  const importLabel = importArmed ? t('settings.importConfirm') : t('settings.import')

  return h(
    'div',
    { className: 'qn-panel qn-settings-panel', 'data-qn-panel': 'settings' },
    panelHead({
      title: t('settings.title'),
      backLabel: t('settings.back'),
      backData: 'settings',
      onBack: () => actions.setView('notes'),
    }),
    h(
      'div',
      { className: 'qn-panel-body' },
      section(
        'settings.appearance',
        STEPPER_FIELDS.map(stepperRow),
        themeRow,
        h(
          'div',
          { className: 'qn-settings-actions' },
          textButton({
            label: t('settings.resetPosition'),
            data: { 'data-qn-reset-position': 'true' },
            onClick: () => actions.resetWindowPosition(),
          }),
        ),
      ),
      section(
        'settings.data',
        h(
          'div',
          { className: 'qn-settings-actions' },
          textButton({
            label: t('settings.export'),
            data: { 'data-qn-export': 'true' },
            onClick: onExport,
            disabled: busy,
          }),
          textButton({
            label: importLabel,
            danger: true,
            armed: importArmed,
            data: { 'data-qn-import': 'true' },
            onClick: onImport,
            disabled: busy,
          }),
        ),
        notice !== null &&
          h(
            'p',
            {
              className: 'qn-settings-notice',
              'data-tone': notice.tone,
              role: notice.tone === 'error' ? 'alert' : 'status',
            },
            t(notice.key, notice.params),
          ),
      ),
      section(
        'settings.sync',
        h('p', { className: 'qn-settings-sync' }, t(syncLabelKey(phase))),
        syncDetail !== null &&
          h('p', { className: 'qn-settings-notice', 'data-tone': 'error' }, syncDetail),
      ),
      section(
        'settings.about',
        h(
          'div',
          { className: 'qn-settings-meta' },
          h(
            'div',
            { className: 'qn-settings-meta-row' },
            h('span', null, t('settings.version')),
            h('span', null, VERSION),
          ),
          h(
            'div',
            { className: 'qn-settings-meta-row' },
            h('span', null, t('settings.project')),
            h(
              'a',
              {
                className: 'qn-settings-link',
                href: PROJECT_URL,
                target: '_blank',
                rel: 'noopener noreferrer',
                title: PROJECT_URL,
              },
              'LittleLemonJam/dsh-quick-notes',
            ),
          ),
        ),
      ),
    ),
  )
}
