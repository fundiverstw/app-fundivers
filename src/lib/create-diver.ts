import { supabase } from './supabase'
import type { Profile } from '../types/database'
import { t } from '../i18n'

const ad = t.admin.addDiver

// supabase-js wraps every non-2xx edge-function response as a FunctionsHttpError
// whose .message is just "Edge Function returned a non-2xx status code"; the
// server's real message ({ error } JSON) is buried in .context (a Response).
// Pull it out so callers see "email already registered" / "forbidden" instead
// of an opaque status error. Same idiom as admin-event-export / scheduled-trips.
async function functionErrorMessage(error: { message: string; context?: unknown }): Promise<string> {
  const ctx = error.context
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = await (ctx as Response).json() as { error?: string }
      if (body?.error) return body.error
    } catch { /* body wasn't JSON — fall back to the generic message */ }
  }
  return error.message
}

export interface CreateDiverAccountInput {
  email: string
  name: string
  nickname?: string
  /** When registering the diver for a specific event in the same flow, the
   *  title threads into the courtesy email's copy. Omitted by the standalone
   *  Create-diver page, which has no event yet. */
  eventTitle?: string
}

// Mints a diver account on behalf of a walk-in via the admin-create-diver edge
// function (auth user + profile promoted out of pending + courtesy email), then
// returns the freshly-updated profile. Shared by the standalone Create-diver
// page and the event-detail "add diver" modal so the account-mint contract —
// body shape, error handling, profile refetch — lives in exactly one place.
export async function createDiverAccount(
  input: CreateDiverAccountInput,
): Promise<{ profile: Profile; emailSent: boolean }> {
  const email = input.email.trim().toLowerCase()
  const name = input.name.trim()

  const { data, error } = await supabase.functions.invoke<{
    ok: boolean
    user_id: string
    email_sent: boolean
  }>('admin-create-diver', {
    body: {
      email,
      name,
      nickname:    input.nickname?.trim() || undefined,
      event_title: input.eventTitle,
    },
  })
  if (error) throw new Error(await functionErrorMessage(error))
  if (!data?.ok || !data.user_id) throw new Error(ad.createFailed)

  const { data: profile, error: profErr } = await supabase
    .from('profiles').select('*').eq('id', data.user_id).single()
  if (profErr || !profile) throw new Error(profErr?.message ?? ad.profileNotFound)

  return { profile: profile as Profile, emailSent: data.email_sent }
}
