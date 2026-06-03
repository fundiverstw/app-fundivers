// Coerce an unknown thrown value to a human-readable string for inline UI
// error banners and toasts. Two responsibilities:
//
// 1. Coercion. The naive `err instanceof Error ? err.message : String(err)`
//    pattern silently produces "[object Object]" for Supabase's
//    PostgrestError / FunctionsHttpError shapes, which aren't instanceof
//    Error but do carry a useful `.message` field.
//
// 2. Audit L3 sanitisation. PostgREST / Postgres errors arrive with a
//    SQLSTATE `code` and a `message` that often discloses schema details
//    — column names, constraint names, occasionally row contents
//    ("duplicate key value violates unique constraint
//    \"profiles_email_key\""). For UI surfaces (toasts, inline banners)
//    we map known SQLSTATEs to friendly strings and fall back to a
//    generic message for unknown DB errors. Authored Error messages
//    pass through unchanged — those are written by us.

const SQLSTATE_FRIENDLY: Record<string, string> = {
  '23505': 'That value is already in use.',
  '23502': 'A required field is missing.',
  '23503': 'A referenced item could not be found.',
  '23514': 'That value failed a validation check.',
  '42501': 'You don\'t have permission to do that.',
  'PGRST116': 'No matching record found.',
  'PGRST301': 'Authentication required.',
}

interface ErrorLike {
  message?: unknown
  error?:   unknown
  code?:    unknown
}

export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err == null) return fallback
  if (typeof err === 'string') return err.trim() || fallback

  if (typeof err === 'object') {
    const obj = err as ErrorLike

    // PostgREST / Postgres errors carry a `code`. Map to a friendly
    // string; suppress the verbose underlying message.
    if (typeof obj.code === 'string' && obj.code.length > 0) {
      if (typeof obj.message === 'string') console.error(`errorMessage suppressed [${obj.code}]:`, obj.message)
      return SQLSTATE_FRIENDLY[obj.code] ?? fallback
    }

    if (err instanceof Error) return err.message || fallback

    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message
    if (typeof obj.error   === 'string' && obj.error.trim())   return obj.error
  }

  return fallback
}
