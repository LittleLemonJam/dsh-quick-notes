/**
 * Unit tests for the Host diagnostic log.
 */
import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDiagnosticLog, sanitizeDiagnosticEntry } from '../../src/host/diagnostics.js'
import { temporaryDirectory } from './_helpers.mjs'

test('sanitizeDiagnosticEntry keeps known kinds and drops unknown ones', () => {
  assert.deepEqual(sanitizeDiagnosticEntry({ kind: 'mounted', version: '0.1.0', mode: 'normal' }), {
    kind: 'mounted',
    version: '0.1.0',
    mode: 'normal',
  })
  assert.equal(sanitizeDiagnosticEntry({ kind: 'evil' }), null)
  assert.equal(sanitizeDiagnosticEntry(null), null)
  assert.deepEqual(sanitizeDiagnosticEntry({ kind: 'mounted', message: 42 }), { kind: 'mounted' })
})

test('sanitizeDiagnosticEntry truncates long fields', () => {
  const entry = sanitizeDiagnosticEntry({
    kind: 'window.error',
    message: 'm'.repeat(5000),
    stack: 's'.repeat(10_000),
  })
  assert.equal(entry.message.length, 2000)
  assert.equal(entry.stack.length, 6000)
})

test('append writes one JSON line per entry', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const log = createDiagnosticLog({ directory, now: () => 1234 })
    assert.deepEqual(await log.append({ kind: 'mounted', version: '0.1.0' }), { ok: true })
    assert.deepEqual(await log.append({ kind: 'render.error', message: 'boom' }), { ok: true })
    const text = await readFile(log.file, 'utf8')
    const lines = text.trim().split('\n')
    assert.equal(lines.length, 2)
    assert.deepEqual(JSON.parse(lines[0]), { at: 1234, kind: 'mounted', version: '0.1.0' })
    assert.equal(JSON.parse(lines[1]).message, 'boom')
  } finally {
    await cleanup()
  }
})

test('append recovers after a failed write instead of poisoning the queue', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    // A file where the log directory should be makes the first append fail.
    const blocked = join(directory, 'blocked')
    await writeFile(blocked, 'x')
    const log = createDiagnosticLog({ directory: blocked })
    const failed = await log.append({ kind: 'mounted' })
    assert.equal(failed.ok, false)
    assert.match(failed.reason, /failed to write/)

    // Recover the path and append again: the queue must not stay rejected.
    await rm(blocked, { force: true })
    const recovered = await log.append({ kind: 'mounted' })
    assert.deepEqual(recovered, { ok: true })
    const lines = (await readFile(log.file, 'utf8')).trim().split('\n')
    assert.equal(lines.length, 1)
    assert.equal(JSON.parse(lines[0]).kind, 'mounted')
  } finally {
    await cleanup()
  }
})

test('append rejects unknown kinds', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const log = createDiagnosticLog({ directory })
    const result = await log.append({ kind: 'not-a-kind' })
    assert.equal(result.ok, false)
    await assert.rejects(() => readFile(log.file, 'utf8'))
  } finally {
    await cleanup()
  }
})

test('the log file is trimmed when it grows past its cap', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const log = createDiagnosticLog({ directory, maxBytes: 400 })
    for (let index = 0; index < 40; index += 1) {
      await log.append({ kind: 'client.warning', message: `entry ${index} ${'x'.repeat(40)}` })
    }
    const text = await readFile(log.file, 'utf8')
    assert.ok(text.length < 400 + 200, `log grew to ${text.length} bytes`)
    assert.match(text, /entry 39/)
  } finally {
    await cleanup()
  }
})

test('sanitizeDiagnosticEntry keeps the theme, mode and sync fields', () => {
  assert.deepEqual(
    sanitizeDiagnosticEntry({
      kind: 'theme',
      theme: 'dark',
      preference: 'dark',
      hostTheme: 'light',
      ignored: 'drop me',
    }),
    { kind: 'theme', theme: 'dark', preference: 'dark', hostTheme: 'light' },
  )
  assert.deepEqual(
    sanitizeDiagnosticEntry({
      kind: 'sync.start',
      host: true,
      usedRemote: false,
      ok: true,
      attempt: 2,
      localSavedAt: 10,
      remoteSavedAt: 20,
      build: '2026-11-01.4',
    }),
    {
      kind: 'sync.start',
      host: true,
      usedRemote: false,
      ok: true,
      attempt: 2,
      localSavedAt: 10,
      remoteSavedAt: 20,
      build: '2026-11-01.4',
    },
  )
  assert.deepEqual(
    sanitizeDiagnosticEntry({ kind: 'mode', mode: 'ball', message: 'viewport=1x2' }),
    { kind: 'mode', mode: 'ball', message: 'viewport=1x2' },
  )
})

test('concurrent appends keep whole lines', async () => {
  const { directory, cleanup } = await temporaryDirectory()
  try {
    const log = createDiagnosticLog({ directory })
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        log.append({ kind: 'mounted', version: `v${index}` }),
      ),
    )
    const lines = (await readFile(join(directory, 'diagnostics.log'), 'utf8')).trim().split('\n')
    assert.equal(lines.length, 10)
    for (const line of lines) JSON.parse(line)
  } finally {
    await cleanup()
  }
})
