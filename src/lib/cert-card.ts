import { supabase } from './supabase'
import { compressImage } from './image-compress'
import { assertUploadSize } from './upload-guard'

export const CERT_CARD_BUCKET = 'cert-cards'

// Signed-URL lifetime for the profile preview. Short-ish so stale URLs don't
// leak — the component refetches whenever the path changes.
const SIGNED_URL_TTL_SECONDS = 60 * 60

/**
 * Compress the picked file and upload to the cert-cards bucket under the
 * user's folder. Returns the stored object path (not a URL).
 */
export async function uploadCertCard(userId: string, file: File): Promise<string> {
  assertUploadSize(file)
  const blob = await compressImage(file)
  const path = `${userId}/card_${Date.now()}.jpg`
  const { error } = await supabase.storage
    .from(CERT_CARD_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw error
  return path
}

export async function getCertCardSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(CERT_CARD_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return null
  return data.signedUrl
}

export async function deleteCertCard(path: string): Promise<void> {
  const { error } = await supabase.storage.from(CERT_CARD_BUCKET).remove([path])
  if (error) throw error
}
