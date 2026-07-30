import { supabase } from './supabase'
import { edgeErrorMessage } from './edge-invoke'
import { t } from '../i18n'

// Admin action: issue a fresh temporary password for a diver's account via the
// admin-set-temp-password edge function and return the plaintext ONCE so the
// admin can relay it. Nobody can read an existing password — this only
// overwrites it. The function admin-gates the caller server-side.
export async function issueTempPassword(userId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean
    password: string
  }>('admin-set-temp-password', { body: { user_id: userId } })
  if (error) throw new Error(await edgeErrorMessage(error))
  if (!data?.ok || !data.password) throw new Error(t.admin.users.tempPasswordFailed)
  return data.password
}
