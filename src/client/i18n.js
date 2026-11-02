/**
 * Locale registration for the Client half.
 *
 * Every component module exports `I18N = { en, zh }`; this module merges the
 * dictionaries into the single `quickNotes` namespace the slot system uses
 * (`locale: NS` on registration makes the host inject `t`).
 */
import { I18N as APP_I18N } from './launcher.js'
import { I18N as WINDOW_I18N } from './components/window.js'
import { I18N as BALL_I18N } from './components/ball.js'
import { I18N as SIDEBAR_I18N } from './components/sidebar.js'
import { I18N as SETTINGS_I18N } from './components/settings.js'
import { I18N as TRASH_I18N } from './components/trash.js'
import { I18N as EDITOR_I18N } from './components/editor.js'
import { I18N as MENU_I18N } from './components/context-menu.js'

/** Locale namespace shared by both slot registrations. */
export const NS = 'quickNotes'

const MODULES = [
  APP_I18N,
  WINDOW_I18N,
  BALL_I18N,
  SIDEBAR_I18N,
  SETTINGS_I18N,
  TRASH_I18N,
  EDITOR_I18N,
  MENU_I18N,
]

/**
 * Merge every module's dictionary for one locale.
 * @param locale - 'en' or 'zh'.
 * @returns the merged dictionary.
 */
function merge(locale) {
  const dictionary = {}
  for (const module of MODULES) Object.assign(dictionary, module[locale] ?? {})
  return dictionary
}

/** English dictionary. */
const EN = merge('en')

/** Chinese dictionary. */
const ZH = merge('zh')

/**
 * Register the namespace on the Client locale service.
 * @param ctx - Client plugin context.
 * @returns the disposer returned by the locale service.
 */
export function registerLocale(ctx) {
  return ctx.locale.register(NS, { en: EN, zh: ZH })
}
