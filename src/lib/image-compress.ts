// Client-side image compression for profile uploads (cert cards, etc.).
// Uses canvas 2D to downscale and re-encode as JPEG — keeps cert-card text
// readable while shrinking a 3–5 MB phone photo to ~150–300 KB.

export interface CompressOptions {
  /** Max of (width, height) after scaling. Defaults to 1600 px. */
  maxDimension?: number
  /** JPEG encoder quality 0..1. Defaults to 0.82. */
  quality?: number
  /** Output mime type. Defaults to image/jpeg. */
  mimeType?: 'image/jpeg' | 'image/webp'
}

const DEFAULT_MAX_DIM = 1600
const DEFAULT_QUALITY = 0.82

/**
 * Pure helper: scale (w, h) so the longer side equals `maxDim`, preserving
 * aspect ratio. No-op if the image is already smaller. Rounded to ints so
 * canvas dimensions are well-defined.
 */
export function computeTargetSize(
  width: number,
  height: number,
  maxDim: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const longest = Math.max(width, height)
  if (longest <= maxDim) return { width: Math.round(width), height: Math.round(height) }
  const scale = maxDim / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * Compress an image File/Blob into a smaller JPEG blob. Preserves EXIF
 * orientation implicitly because `createImageBitmap` applies it on modern
 * browsers (Chromium, Firefox, Safari 17+).
 */
export async function compressImage(file: Blob, opts: CompressOptions = {}): Promise<Blob> {
  const maxDim = opts.maxDimension ?? DEFAULT_MAX_DIM
  const quality = opts.quality ?? DEFAULT_QUALITY
  const mime = opts.mimeType ?? 'image/jpeg'

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' as ImageOrientation })
  try {
    const { width, height } = computeTargetSize(bitmap.width, bitmap.height, maxDim)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(bitmap, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        b => b ? resolve(b) : reject(new Error('Canvas toBlob returned null')),
        mime,
        quality,
      )
    })
  } finally {
    bitmap.close?.()
  }
}
