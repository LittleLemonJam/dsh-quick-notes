/**
 * Static contract checks for the plugin package.
 *
 * The checks are intentionally dependency-light: they validate the manifest,
 * the Loader patch, display resources, the generated Client artifact and the
 * source-level rules this repository promises in docs/architecture.md.
 *
 * Usage: node scripts/check.mjs
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parse as parseYaml } from 'yaml'

const run = promisify(execFile)
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_NAME = 'dsh-quick-notes'
const MAX_ICON_BYTES = 256 * 1024

const failures = []
const notes = []

/**
 * Record one failed check.
 * @param message - human readable failure.
 */
function fail(message) {
  failures.push(message)
}

/**
 * Record one passed check worth mentioning.
 * @param message - human readable note.
 */
function pass(message) {
  notes.push(message)
}

/**
 * Read and parse a JSON file.
 * @param path - absolute path.
 * @returns parsed value.
 */
async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

/**
 * Assert one condition.
 * @param condition - condition to assert.
 * @param message - failure message.
 */
function assert(condition, message) {
  if (!condition) fail(message)
}

// ---------------------------------------------------------------- manifest
const manifest = await readJson(join(PACKAGE_ROOT, 'package.json'))
assert(manifest.name === PACKAGE_NAME, `package.json name must be ${PACKAGE_NAME}`)
assert(
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(manifest.version)),
  'package.json version must be semver',
)
assert(manifest.type === 'module', 'package.json type must be "module"')
assert(manifest.main === './index.js', 'package.json main must be ./index.js')
assert(manifest.exports?.['.'] === './index.js', 'package.json exports["."] must be ./index.js')
assert(
  manifest.exports?.['./client'] === './client.js',
  'package.json exports["./client"] must be ./client.js',
)
assert(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch must be declared')
assert(manifest.dsh?.client?.platform === 'web', 'dsh.client.platform must be "web"')
assert(manifest.dsh?.client?.immediately === true, 'dsh.client.immediately must be true')
assert(typeof manifest.icon === 'string', 'package.json icon must be declared')
for (const entry of ['client.js', 'index.js', 'cordis.patch.yml', 'src/host', 'src/shared']) {
  assert(
    Array.isArray(manifest.files) && manifest.files.includes(entry),
    `files must include ${entry}`,
  )
}
pass('manifest: package.json contract')

// ---------------------------------------------------------------- loader patch
const patchText = await readFile(join(PACKAGE_ROOT, 'cordis.patch.yml'), 'utf8')
const patch = parseYaml(patchText)
assert(Array.isArray(patch), 'cordis.patch.yml must be a YAML array')
const inserted = Array.isArray(patch) ? patch.flatMap((row) => row?.insert ?? []) : []
const row = inserted.find((item) => item?.name === PACKAGE_NAME)
assert(row !== undefined, `cordis.patch.yml must insert ${PACKAGE_NAME}`)
assert(row?.id === PACKAGE_NAME, `cordis.patch.yml insert id must be ${PACKAGE_NAME}`)
pass('patch: cordis.patch.yml contract')

// ---------------------------------------------------------------- locales
for (const locale of ['en', 'zh']) {
  const path = join(PACKAGE_ROOT, 'locale', `${locale}.json`)
  let value
  try {
    value = await readJson(path)
  } catch (error) {
    fail(`locale/${locale}.json is not valid JSON: ${error.message}`)
    continue
  }
  assert(
    typeof value?.meta?.title === 'string' && value.meta.title.trim() !== '',
    `locale/${locale}.json meta.title must be a non-empty string`,
  )
  assert(
    typeof value?.meta?.description === 'string' && value.meta.description.trim() !== '',
    `locale/${locale}.json meta.description must be a non-empty string`,
  )
}
pass('display: locale metadata')

// ---------------------------------------------------------------- icon
const iconPath = join(PACKAGE_ROOT, 'icon.svg')
const iconStat = await stat(iconPath).catch(() => null)
assert(iconStat !== null, 'icon.svg must exist')
if (iconStat !== null) {
  assert(iconStat.size <= MAX_ICON_BYTES, `icon.svg exceeds ${MAX_ICON_BYTES} bytes`)
  const iconText = await readFile(iconPath, 'utf8')
  assert(iconText.trimStart().startsWith('<svg'), 'icon.svg must be an SVG document')
  assert(iconText.includes('viewBox'), 'icon.svg must declare a viewBox')
}
pass('display: icon')

// ---------------------------------------------------------------- client artifact
const clientPath = join(PACKAGE_ROOT, 'client.js')
const clientStat = await stat(clientPath).catch(() => null)
assert(clientStat !== null, 'client.js must exist (run npm run build)')
if (clientStat !== null) {
  const clientText = await readFile(clientPath, 'utf8')
  assert(
    clientText.includes('window.__ModuleLoader__.load('),
    'client.js must register through window.__ModuleLoader__',
  )
  assert(
    clientText.includes(`id: '${PACKAGE_NAME}'`),
    `client.js loader id must be ${PACKAGE_NAME}`,
  )
  assert(
    !clientText.includes('require("@deepseek-ai/') &&
      !clientText.includes("require('@deepseek-ai/"),
    'client.js must not require Harness packages',
  )
  const requires = [...clientText.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1])
  for (const request of requires) {
    assert(request === 'react', `client.js may only require react, found: ${request}`)
  }
  pass(`client: artifact (${Buffer.byteLength(clientText, 'utf8')} bytes)`)
}

// ---------------------------------------------------------------- source rules
const sourceFiles = []
/**
 * Walk one directory collecting .js sources.
 * @param directory - absolute directory.
 */
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (entry.isFile() && entry.name.endsWith('.js')) sourceFiles.push(path)
  }
}
await walk(join(PACKAGE_ROOT, 'src'))
sourceFiles.push(join(PACKAGE_ROOT, 'index.js'))
for (const path of sourceFiles) {
  // `relative` yields backslashes on Windows; normalise before prefix checks.
  const relativePath = relative(PACKAGE_ROOT, path).split(sep).join('/')
  try {
    await run(process.execPath, ['--check', path])
  } catch (error) {
    fail(`${relativePath} has a syntax error: ${String(error.stderr || error.message).trim()}`)
  }
  const text = await readFile(path, 'utf8')
  if (relativePath.startsWith('src/client/')) {
    assert(
      !/from\s+['"]@deepseek-ai\//.test(text) && !/require\(['"]@deepseek-ai\//.test(text),
      `${relativePath} must not import Harness packages`,
    )
    assert(
      !/document\.body\.appendChild|document\.body\.innerHTML/.test(text),
      `${relativePath} must not write to document.body`,
    )
  }
  if (relativePath.startsWith('src/host/')) {
    assert(
      !/from\s+['"]@deepseek-ai\//.test(text),
      `${relativePath} must only import node builtins and local modules`,
    )
  }
}
pass(`source: ${sourceFiles.length} JavaScript modules parsed`)

// ---------------------------------------------------------------- component contract
const componentFiles = await readdir(join(PACKAGE_ROOT, 'src', 'client', 'components'))
for (const file of componentFiles.filter((name) => name.endsWith('.js'))) {
  const text = await readFile(join(PACKAGE_ROOT, 'src', 'client', 'components', file), 'utf8')
  if (file === 'format.js' || file === 'geometry.js') continue
  assert(/export const CSS\b/.test(text), `components/${file} must export CSS`)
  assert(/export const I18N\b/.test(text), `components/${file} must export I18N`)
}
pass('components: CSS/I18N exports')

// ---------------------------------------------------------------- summary
for (const note of notes) console.log(`ok  ${note}`)
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\nall checks passed')
