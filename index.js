/**
 * Host half of the dsh-quick-notes bundle.
 *
 * The floating window lives in the browser. This half owns the durable copy of
 * the notes: it registers two same-origin routes on the Web server and writes
 * the state file under `$DSH_HOME/quick-notes/notes.json`.
 *
 * Routes:
 *   GET  /dsh-quick-notes/state       read the persisted state
 *   PUT  /dsh-quick-notes/state       replace the persisted state
 *   GET  /dsh-quick-notes/health      read-only self report
 *   POST /dsh-quick-notes/diagnostic  append a Client diagnostic entry
 */
import { readFileSync } from 'node:fs'
import { DIAGNOSTIC_PATH, HEALTH_PATH, STATE_PATH } from './src/shared/constants.js'
import { createRequestFence } from './src/host/fence.js'
import { notesDir } from './src/host/paths.js'
import { createHandlers } from './src/host/routes.js'

/** The Web server is the only Host dependency. */
export const inject = ['webServer']

/** The installed package version, reported by the health route. */
const VERSION = (() => {
  try {
    return (
      JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ??
      '0.0.0'
    )
  } catch {
    return '0.0.0'
  }
})()

/**
 * Register the plugin's routes for the lifetime of the plugin fiber.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  const logger = ctx.logger ?? null
  const fence = createRequestFence({
    getOrigin: () => ctx.webServer?.getOrigin?.(),
    logger,
  })
  const handlers = createHandlers({
    directory: notesDir(),
    version: VERSION,
    logger,
    fence,
  })

  const routes = [
    { label: 'state route', path: STATE_PATH, handler: handlers.state },
    { label: 'health route', path: HEALTH_PATH, handler: handlers.health },
    { label: 'diagnostic route', path: DIAGNOSTIC_PATH, handler: handlers.diagnostic },
  ]
  for (const route of routes) {
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'exact',
          path: route.path,
          handler: route.handler,
        }),
      `dsh-quick-notes: ${route.label}`,
    )
  }

  logger?.info?.(`dsh-quick-notes: state file ${handlers.store.file}`)
}
