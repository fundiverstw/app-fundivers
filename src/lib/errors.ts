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

// Field-specific translations. Postgres names the offending constraint /
// column in its `message` / `details` (e.g. "violates foreign key
// constraint \"EO_courses_prereq_cert_id_fkey\""). We match on that name
// and return our OWN authored copy that tells the user which field to fix
// — we never echo the raw Postgres text (audit L3 still holds). The
// generic SQLSTATE string is the fallback when nothing matches.
const CONSTRAINT_FRIENDLY: { pattern: RegExp; message: string }[] = [
  { pattern: /prereq_cert_id/, message: 'The required certification you selected is no longer available. Choose a different level or select "None".' },
  { pattern: /_price_fkey/,    message: 'The price tier you selected is no longer available. Pick a different one.' },
  { pattern: /cancel_policy/,  message: 'The cancellation policy you selected is no longer available. Pick a different one.' },
  { pattern: /course_days/,    message: 'A course can have at most 4 days.' },
]

function fieldSpecificMessage(haystack: string): string | null {
  for (const { pattern, message } of CONSTRAINT_FRIENDLY) {
    if (pattern.test(haystack)) return message
  }
  return null
}

interface ErrorLike {
  message?: unknown
  details?: unknown
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
      const raw     = typeof obj.message === 'string' ? obj.message : ''
      const details = typeof obj.details === 'string' ? obj.details : ''
      if (raw) console.error(`errorMessage suppressed [${obj.code}]:`, raw)
      // Prefer a field-specific message derived from the constraint name.
      const specific = fieldSpecificMessage(`${raw} ${details}`)
      if (specific) return specific
      return SQLSTATE_FRIENDLY[obj.code] ?? fallback
    }

    if (err instanceof Error) return err.message || fallback

    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message
    if (typeof obj.error   === 'string' && obj.error.trim())   return obj.error
  }

  return fallback
}
