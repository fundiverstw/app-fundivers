import { supabase } from './supabase'
import { compressImage } from './image-compress'
import { assertUploadSize } from './upload-guard'

export const DEEP_CARD_BUCKET = 'deep-cards'

const SIGNED_URL_TTL_SECONDS = 60 * 60

export async function uploadDeepCard(userId: string, file: File): Promise<string> {
  assertUploadSize(file)
  const blob = await compressImage(file)
  const path = `${userId}/card_${Date.now()}.jpg`
  const { error } = await supabase.storage
    .from(DEEP_CARD_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw error
  return path
}

export async function getDeepCardSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(DEEP_CARD_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return null
  return data.signedUrl
}

export async function deleteDeepCard(path: string): Promise<void> {
  const { error } = await supabase.storage.from(DEEP_CARD_BUCKET).remove([path])
  if (error) throw error
}
