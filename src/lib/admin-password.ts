import { supabase } from './supabase'
import { t } from '../i18n'

// supabase-js wraps every non-2xx edge-function response as a FunctionsHttpError
// whose .message is just "Edge Function returned a non-2xx status code"; the
// server's real message ({ error } JSON) is buried in .context (a Response).
// Pull it out so callers see "forbidden" / "user not found" instead of an
// opaque status error. Same idiom as create-diver.ts.
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

// Admin action: issue a fresh temporary password for a diver's account via the
// admin-set-temp-password edge function and return the plaintext ONCE so the
// admin can relay it. Nobody can read an existing password — this only
// overwrites it. The function admin-gates the caller server-side.
export async function issueTempPassword(userId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean
    password: string
  }>('admin-set-temp-password', { body: { user_id: userId } })
  if (error) throw new Error(await functionErrorMessage(error))
  if (!data?.ok || !data.password) throw new Error(t.admin.users.tempPasswordFailed)
  return data.password
}
