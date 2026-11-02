/**
 * Directory resolution for the Host half.
 *
 * `DSH_HOME` mirrors the harness home; `DSH_QUICK_NOTES_DIR` overrides the
 * data directory (used by tests and by users who keep their notes elsewhere).
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Expand a leading `~` / `~\` / `~/` to the user's home directory.
 * @param value - raw path value.
 * @returns the expanded path.
 */
function expandHomePath(value) {
  const trimmed = String(value ?? '').trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(homedir(), trimmed.slice(2))
  }
  return trimmed
}

/** The harness home directory: `DSH_HOME` when set, else `~/.dsh`. */
function dshHomeDir() {
  const home = process.env.DSH_HOME
  return home !== undefined && home.trim() !== ''
    ? resolve(expandHomePath(home))
    : join(homedir(), '.dsh')
}

/** The notes data directory: `DSH_QUICK_NOTES_DIR` when set, else `<dsh home>/quick-notes`. */
export function notesDir() {
  const override = process.env.DSH_QUICK_NOTES_DIR
  if (override !== undefined && override.trim() !== '') return resolve(expandHomePath(override))
  return join(dshHomeDir(), 'quick-notes')
}
