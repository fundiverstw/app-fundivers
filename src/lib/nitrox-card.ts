import { supabase } from './supabase'
import { compressImage } from './image-compress'
import { assertUploadSize } from './upload-guard'

export const NITROX_CARD_BUCKET = 'nitrox-cards'

const SIGNED_URL_TTL_SECONDS = 60 * 60

export async function uploadNitroxCard(userId: string, file: File): Promise<string> {
  assertUploadSize(file)
  const blob = await compressImage(file)
  const path = `${userId}/card_${Date.now()}.jpg`
  const { error } = await supabase.storage
    .from(NITROX_CARD_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw error
  return path
}

export async function getNitroxCardSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(NITROX_CARD_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return null
  return data.signedUrl
}

export async function deleteNitroxCard(path: string): Promise<void> {
  const { error } = await supabase.storage.from(NITROX_CARD_BUCKET).remove([path])
  if (error) throw error
}
