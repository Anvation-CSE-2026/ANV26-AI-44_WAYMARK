/** Photos above this size are shrunk in the browser before upload (the server limit is 10 MB by default). */
export const DOWNSCALE_ABOVE_BYTES = 8 * 1024 * 1024
const MAX_SIDE = 2000

/**
 * Shrinks a very large photo so it fits the server's size limit. Smaller photos are sent untouched on purpose:
 * re-drawing a picture on a canvas drops its EXIF data, and the server needs the location and time in it to set the
 * "taken near the cells" and "old photo" flags. If the browser cannot decode the file (for example HEIC), the
 * original is sent and the server decides.
 */
export async function downscaleIfLarge(file: File): Promise<Blob> {
  if (file.size <= DOWNSCALE_ABOVE_BYTES) return file
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}
