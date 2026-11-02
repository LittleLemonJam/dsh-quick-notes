/**
 * Client-side image ingestion for pasted / dropped pictures.
 *
 * Notes are plain HTML stored in one JSON state file, so a picture has to live
 * inside the note as a `data:` URL. Pasted screenshots can be many megabytes
 * wide, which would both break the layout and blow the state budget, so every
 * picture goes through a canvas: it is scaled down proportionally (longest edge
 * ≤ {@link IMAGE_MAX_DIMENSION}) and re-encoded (PNG when the source may have
 * alpha, JPEG otherwise). If the resulting data URL is still above the budget,
 * the picture is shrunk step by step until it fits or the floor is reached.
 *
 * The module is DOM-optional: without a usable `document`/canvas (Node tests,
 * hardened browsers) `readImageFile` resolves to `null` and the editor simply
 * ignores the file instead of inserting the original bytes. Only the pure
 * helpers (`fitDimensions`, `isImageFile`) are exported for unit tests.
 */

/** Longest edge of an inserted picture, in source pixels. */
export const IMAGE_MAX_DIMENSION = 1024

/** Maximum length of one image data URL, in characters (≈ 340 KiB of base64). */
export const IMAGE_DATA_URL_BUDGET = 450_000

/** Smallest longest edge the shrink loop will try before giving up. */
export const IMAGE_MIN_DIMENSION = 320

/** JPEG quality used for opaque pictures. */
export const IMAGE_JPEG_QUALITY = 0.82

/** Scale factor applied to the longest edge on every budget-shrink attempt. */
const IMAGE_SHRINK_FACTOR = 0.75

/** Hard stop for the shrink loop, so a pathological input cannot spin. */
const MAX_SHRINK_ATTEMPTS = 12

/** Raster MIME types the sanitiser accepts back from persistence. */
const SUPPORTED_IMAGE_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
])

/**
 * Whether a clipboard/drag item is an image file the editor should ingest.
 * @param file - candidate `File`-like object.
 * @returns whether it advertises an `image/*` type.
 */
export function isImageFile(file) {
  return (
    file !== null &&
    typeof file === 'object' &&
    typeof file.type === 'string' &&
    file.type.toLowerCase().startsWith('image/')
  )
}

/**
 * Scale one picture down proportionally so its longest edge fits a limit.
 * Pictures already smaller than the limit are returned unchanged.
 *
 * @param width - source width in pixels.
 * @param height - source height in pixels.
 * @param maxDimension - longest allowed edge in pixels.
 * @returns the target `{ width, height }`, or null for unusable input.
 */
export function fitDimensions(width, height, maxDimension) {
  const sourceWidth = Number(width)
  const sourceHeight = Number(height)
  const limit = Number(maxDimension)
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) return null
  if (!Number.isFinite(limit)) return null
  if (sourceWidth <= 0 || sourceHeight <= 0 || limit < 1) return null
  const scale = Math.min(1, limit / Math.max(sourceWidth, sourceHeight))
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

/**
 * Read a positive finite number, falling back when the option is unusable.
 * @param value - candidate option value.
 * @param fallback - value used when the candidate is not a positive number.
 * @returns the resolved number.
 */
function positiveNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Clamp a quality factor into the 0..1 range.
 * @param value - candidate quality.
 * @param fallback - value used when the candidate is not a number.
 * @returns the resolved quality.
 */
function qualityNumber(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

/**
 * Whether a source MIME type may carry transparency (encoded as PNG).
 * @param type - lower-case MIME type.
 * @returns whether PNG should be used.
 */
function usesAlpha(type) {
  return type !== 'image/jpeg' && type !== 'image/jpg'
}

/**
 * Resolve a 2D canvas context, tolerating environments without canvas support.
 * @param canvas - canvas element.
 * @returns the 2D context, or null when unsupported.
 */
function get2dContext(canvas) {
  if (typeof canvas.getContext !== 'function') return null
  try {
    return canvas.getContext('2d') ?? null
  } catch {
    return null
  }
}

/**
 * Load the decoded pixels of one file.
 *
 * `createImageBitmap` is preferred (off-main-thread decode, no object URL); the
 * `HTMLImageElement` + object URL path is the fallback. The returned handle owns
 * its resources and exposes `dispose()`.
 *
 * @param file - `File`-like image blob.
 * @param document - owner document.
 * @returns `{ image, width, height, dispose }` or null when unreadable.
 */
async function loadImageSource(file, document) {
  const createBitmap = typeof globalThis === 'undefined' ? undefined : globalThis.createImageBitmap
  if (typeof createBitmap === 'function') {
    try {
      const bitmap = await createBitmap(file)
      const width = Number(bitmap?.width)
      const height = Number(bitmap?.height)
      if (width > 0 && height > 0) {
        return {
          image: bitmap,
          width,
          height,
          dispose: () => {
            if (typeof bitmap.close === 'function') bitmap.close()
          },
        }
      }
      if (typeof bitmap?.close === 'function') bitmap.close()
      return null
    } catch {
      // Fall through to the image-element path.
    }
  }
  const objectUrls = typeof globalThis === 'undefined' ? undefined : globalThis.URL
  if (typeof objectUrls?.createObjectURL !== 'function') return null
  let url
  try {
    url = objectUrls.createObjectURL(file)
  } catch {
    return null
  }
  const image = document.createElement('img')
  const revoke = () => {
    if (typeof objectUrls.revokeObjectURL === 'function') objectUrls.revokeObjectURL(url)
  }
  try {
    await new Promise((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('image decode failed'))
      image.src = url
    })
  } catch {
    revoke()
    return null
  }
  const width = Number(image.naturalWidth ?? image.width)
  const height = Number(image.naturalHeight ?? image.height)
  if (!(width > 0 && height > 0)) {
    revoke()
    return null
  }
  return { image, width, height, dispose: revoke }
}

/**
 * Convert a pasted / dropped image file into a bounded `data:` URL.
 *
 * @param file - `File`-like image blob (only raster types are supported).
 * @param options - overrides for the defaults: `maxDimension`,
 *   `maxDataUrlLength`, `minDimension`, `quality`, `shrinkFactor`.
 * @returns the data URL, or null when the environment/file cannot be handled.
 */
export async function readImageFile(file, options = {}) {
  const type = typeof file?.type === 'string' ? file.type.toLowerCase() : ''
  if (!SUPPORTED_IMAGE_TYPES.includes(type)) return null
  const document = typeof globalThis === 'undefined' ? undefined : globalThis.document
  if (document === null || document === undefined) return null
  if (typeof document.createElement !== 'function') return null
  const maxDimension = positiveNumber(options.maxDimension, IMAGE_MAX_DIMENSION)
  const minDimension = Math.min(
    maxDimension,
    positiveNumber(options.minDimension, IMAGE_MIN_DIMENSION),
  )
  const maxDataUrlLength = positiveNumber(options.maxDataUrlLength, IMAGE_DATA_URL_BUDGET)
  const quality = qualityNumber(options.quality, IMAGE_JPEG_QUALITY)
  const shrinkFactor = Math.min(
    0.9,
    Math.max(0.1, positiveNumber(options.shrinkFactor, IMAGE_SHRINK_FACTOR)),
  )
  const mimeType = usesAlpha(type) ? 'image/png' : 'image/jpeg'
  const canvas = document.createElement('canvas')
  const context = get2dContext(canvas)
  if (context === null) return null
  let source = null
  try {
    source = await loadImageSource(file, document)
    if (source === null) return null
    let limit = Math.max(minDimension, maxDimension)
    let previousSize = ''
    for (let attempt = 0; attempt < MAX_SHRINK_ATTEMPTS; attempt += 1) {
      const target = fitDimensions(source.width, source.height, limit)
      if (target === null) return null
      const sizeKey = `${target.width}x${target.height}`
      if (sizeKey === previousSize) break
      previousSize = sizeKey
      canvas.width = target.width
      canvas.height = target.height
      context.clearRect(0, 0, target.width, target.height)
      context.drawImage(source.image, 0, 0, target.width, target.height)
      let dataUrl
      try {
        dataUrl = canvas.toDataURL(mimeType, quality)
      } catch {
        return null
      }
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null
      if (dataUrl.length <= maxDataUrlLength) return dataUrl
      // Advance from the size actually encoded, not from the previous cap: a
      // source smaller than `maxDimension` (e.g. a 700 px screenshot) encodes at
      // its natural size first, so a `limit * shrinkFactor` step would keep
      // asking for the same size and give up instead of shrinking below it.
      const longest = Math.max(target.width, target.height)
      if (longest <= minDimension) break
      limit = Math.max(minDimension, Math.round(longest * shrinkFactor))
    }
    return null
  } catch {
    return null
  } finally {
    if (source !== null && typeof source.dispose === 'function') source.dispose()
  }
}
