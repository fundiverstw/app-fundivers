import { supabase } from './supabase'
import { assertUploadSize } from './upload-guard'

// Shop-uploaded PDF waiver templates. Mirrors src/lib/cert-card.ts, but the
// bucket is admin-write / any-authenticated-read (shared shop templates, not
// per-diver private cards), and PDFs are stored as-is (no image compression).

export const WAIVER_PDF_BUCKET = 'waiver-pdfs'

// Signed-URL lifetime for the in-app viewer. Short-ish; callers refetch when
// the path changes.
const SIGNED_URL_TTL_SECONDS = 60 * 60

/**
 * Admin: upload a PDF template under the waiver's id folder. `key` is the
 * waiver id (edit) or a freshly-minted uuid (create, before the row exists).
 * Returns the stored object path (not a URL).
 */
export async function uploadWaiverPdf(key: string, file: File): Promise<string> {
  assertUploadSize(file)
  const path = `${key}/waiver_${Date.now()}.pdf`
  const { error } = await supabase.storage
    .from(WAIVER_PDF_BUCKET)
    .upload(path, file, { contentType: 'application/pdf', upsert: true })
  if (error) throw error
  return path
}

export async function getWaiverPdfSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(WAIVER_PDF_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return null
  return data.signedUrl
}

export async function deleteWaiverPdf(path: string): Promise<void> {
  const { error } = await supabase.storage.from(WAIVER_PDF_BUCKET).remove([path])
  if (error) throw error
}
