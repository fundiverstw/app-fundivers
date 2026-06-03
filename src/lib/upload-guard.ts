// Audit L5 — client-side cap on file uploads. heic2any /
// image-compress runs in-browser; a 200 MB HEIC will OOM the tab
// before ever reaching the server. The server-side limit is the
// real source of truth, but a precheck saves the UX (and the
// crash). 25 MB is loose enough for any phone photo at full size
// and tight enough that nobody can drop a video file by mistake.

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export const MAX_UPLOAD_LABEL = '25 MB'

export class FileTooLargeError extends Error {
  sizeBytes: number
  constructor(sizeBytes: number) {
    super(
      `File is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_UPLOAD_LABEL}.`,
    )
    this.name = 'FileTooLargeError'
    this.sizeBytes = sizeBytes
  }
}

export function assertUploadSize(file: { size: number }): void {
  if (file.size > MAX_UPLOAD_BYTES) throw new FileTooLargeError(file.size)
}
