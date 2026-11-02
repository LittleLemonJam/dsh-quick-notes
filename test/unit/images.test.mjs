/**
 * Unit tests for `src/client/images.js`.
 *
 * `fitDimensions` is pure math and tested directly. `readImageFile` is exercised
 * three ways: with no DOM (Node), with a jsdom document whose canvas is
 * unavailable (the graceful-degradation path the editor relies on), and with a
 * stubbed canvas/`createImageBitmap` pair so the resize + budget loop can be
 * asserted without a real browser.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM, VirtualConsole } from 'jsdom'
import {
  fitDimensions,
  IMAGE_DATA_URL_BUDGET,
  IMAGE_JPEG_QUALITY,
  IMAGE_MAX_DIMENSION,
  IMAGE_MIN_DIMENSION,
  isImageFile,
  readImageFile,
} from '../../src/client/images.js'

/**
 * Run a callback with the image environment temporarily replaced.
 * @param environment - `{ document, createImageBitmap }` overrides (undefined deletes).
 * @param callback - code to run.
 * @returns whatever the callback returns.
 */
async function withImageEnvironment(environment, callback) {
  const savedDocument = globalThis.document
  const savedBitmap = globalThis.createImageBitmap
  try {
    if (environment.document === undefined) delete globalThis.document
    else globalThis.document = environment.document
    if (environment.createImageBitmap === undefined) delete globalThis.createImageBitmap
    else globalThis.createImageBitmap = environment.createImageBitmap
    return await callback()
  } finally {
    if (savedDocument === undefined) delete globalThis.document
    else globalThis.document = savedDocument
    if (savedBitmap === undefined) delete globalThis.createImageBitmap
    else globalThis.createImageBitmap = savedBitmap
  }
}

/**
 * Build a fake canvas/document pair that records encoded sizes.
 * @param options - `payloadFactor` and `bitmap` (source dimensions).
 * @returns `{ document, encoded, closeCalls }`.
 */
function fakeCanvasEnvironment(options = {}) {
  const encoded = []
  const closeCalls = []
  const payloadFactor = options.payloadFactor ?? 0.5
  const bitmapSize = options.bitmap ?? { width: 4000, height: 2000 }
  const document = {
    createElement(tag) {
      assert.equal(tag, 'canvas')
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          clearRect() {},
          drawImage() {},
        }),
        toDataURL: (mimeType, quality) => {
          encoded.push({ mimeType, quality, width: canvas.width, height: canvas.height })
          const payload = 'A'.repeat(Math.max(1, Math.round(canvas.width * payloadFactor)))
          return `data:image/png;base64,${payload}`
        },
      }
      return canvas
    },
  }
  const createImageBitmap = async () => ({
    width: bitmapSize.width,
    height: bitmapSize.height,
    close() {
      closeCalls.push(true)
    },
  })
  return { document, createImageBitmap, encoded, closeCalls }
}

test('fitDimensions: scales proportionally and never upscales', () => {
  assert.deepEqual(fitDimensions(2048, 1024, 1024), { width: 1024, height: 512 })
  assert.deepEqual(fitDimensions(1024, 2048, 1024), { width: 512, height: 1024 })
  assert.deepEqual(fitDimensions(1024, 1024, 1024), { width: 1024, height: 1024 })
  assert.deepEqual(fitDimensions(800, 600, 1024), { width: 800, height: 600 })
  assert.deepEqual(fitDimensions(4000, 1000, 400), { width: 400, height: 100 })
  assert.deepEqual(fitDimensions(1000, 333, 400), { width: 400, height: 133 })
  assert.deepEqual(fitDimensions(1, 10000, 1024), { width: 1, height: 1024 })
})

test('fitDimensions: rejects unusable input', () => {
  assert.equal(fitDimensions(0, 100, 1024), null)
  assert.equal(fitDimensions(100, 0, 1024), null)
  assert.equal(fitDimensions(-5, 100, 1024), null)
  assert.equal(fitDimensions(Number.NaN, 100, 1024), null)
  assert.equal(fitDimensions(100, Number.POSITIVE_INFINITY, 1024), null)
  assert.equal(fitDimensions(100, 100, 0), null)
  assert.equal(fitDimensions(100, 100, Number.NaN), null)
})

test('isImageFile: only recognises image MIME types', () => {
  assert.equal(isImageFile({ type: 'image/png' }), true)
  assert.equal(isImageFile({ type: 'IMAGE/JPEG' }), true)
  assert.equal(isImageFile({ type: 'text/plain' }), false)
  assert.equal(isImageFile({ type: 42 }), false)
  assert.equal(isImageFile(null), false)
  assert.equal(isImageFile(undefined), false)
})

test('module constants: document the default budget', () => {
  assert.equal(IMAGE_MAX_DIMENSION, 1024)
  assert.equal(IMAGE_DATA_URL_BUDGET, 450_000)
  assert.equal(IMAGE_MIN_DIMENSION, 320)
  assert.equal(IMAGE_JPEG_QUALITY, 0.82)
})

test('readImageFile: null without a DOM (Node)', async () => {
  const dataUrl = await withImageEnvironment({}, () =>
    readImageFile({ type: 'image/png', size: 1024 }),
  )
  assert.equal(dataUrl, null)
})

test('readImageFile: null when the document has no usable canvas', async () => {
  const virtualConsole = new VirtualConsole()
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { virtualConsole })
  const dataUrl = await withImageEnvironment({ document: dom.window.document }, () =>
    readImageFile({ type: 'image/png' }),
  )
  assert.equal(dataUrl, null)
})

test('readImageFile: ignores unsupported image types before touching the DOM', async () => {
  const environment = fakeCanvasEnvironment()
  const svg = await withImageEnvironment(environment, () =>
    readImageFile({ type: 'image/svg+xml' }),
  )
  assert.equal(svg, null)
  assert.equal(environment.encoded.length, 0)
})

test('readImageFile: scales to the max dimension, encodes PNG and disposes the bitmap', async () => {
  const environment = fakeCanvasEnvironment()
  const dataUrl = await withImageEnvironment(environment, () =>
    readImageFile({ type: 'image/png' }, { maxDimension: 1024 }),
  )
  assert.notEqual(dataUrl, null)
  assert.equal(environment.encoded.length, 1)
  assert.deepEqual(
    { width: environment.encoded[0].width, height: environment.encoded[0].height },
    { width: 1024, height: 512 },
  )
  assert.equal(environment.encoded[0].mimeType, 'image/png')
  assert.equal(environment.closeCalls.length, 1)
})

test('readImageFile: encodes JPEG for opaque sources', async () => {
  const environment = fakeCanvasEnvironment()
  const dataUrl = await withImageEnvironment(environment, () =>
    readImageFile({ type: 'image/jpeg' }, { maxDimension: 512 }),
  )
  assert.notEqual(dataUrl, null)
  assert.equal(environment.encoded[0].mimeType, 'image/jpeg')
  assert.equal(environment.encoded[0].quality, IMAGE_JPEG_QUALITY)
  assert.deepEqual(
    { width: environment.encoded[0].width, height: environment.encoded[0].height },
    { width: 512, height: 256 },
  )
})

test('readImageFile: shrinks step by step until the data URL fits the budget', async () => {
  const environment = fakeCanvasEnvironment()
  const dataUrl = await withImageEnvironment(environment, () =>
    readImageFile({ type: 'image/png' }, { maxDimension: 1024, maxDataUrlLength: 500 }),
  )
  assert.notEqual(dataUrl, null)
  assert.ok(dataUrl.length <= 500)
  assert.deepEqual(
    environment.encoded.map((entry) => `${entry.width}x${entry.height}`),
    ['1024x512', '768x384'],
  )
})

test('readImageFile: shrinks a source below its natural size when over budget', async () => {
  // Regression: a 700 px screenshot is smaller than `maxDimension`, so the first
  // encode happens at 700 px. The next step must be derived from that encoded
  // size, otherwise the loop asks for 700 px again and gives up without ever
  // trying a smaller size.
  const environment = fakeCanvasEnvironment({
    bitmap: { width: 700, height: 700 },
    payloadFactor: 1,
  })
  const dataUrl = await withImageEnvironment(environment, () =>
    readImageFile({ type: 'image/png' }, { maxDimension: 1024, maxDataUrlLength: 500 }),
  )
  assert.notEqual(dataUrl, null)
  assert.ok(dataUrl.length <= 500)
  assert.deepEqual(
    environment.encoded.map((entry) => `${entry.width}x${entry.height}`),
    ['700x700', '525x525', '394x394'],
  )
  assert.equal(environment.closeCalls.length, 1)
})

test('readImageFile: gives up at the minimum dimension instead of looping forever', async () => {
  const environment = fakeCanvasEnvironment({ payloadFactor: 10 })
  const dataUrl = await withImageEnvironment(environment, () =>
    readImageFile({ type: 'image/png' }, { maxDimension: 1024, maxDataUrlLength: 10 }),
  )
  assert.equal(dataUrl, null)
  const sizes = environment.encoded.map((entry) => `${entry.width}x${entry.height}`)
  assert.equal(sizes.length, 6)
  assert.equal(sizes[sizes.length - 1], '320x160')
})

test('readImageFile: null when image decoding fails', async () => {
  const environment = fakeCanvasEnvironment()
  environment.createImageBitmap = async () => {
    throw new Error('decode failed')
  }
  const dataUrl = await withImageEnvironment(environment, () =>
    readImageFile({ type: 'image/png' }),
  )
  assert.equal(dataUrl, null)
})
