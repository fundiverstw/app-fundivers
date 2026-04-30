// Coerce an unknown thrown value to a human-readable string for inline UI
// error banners. The naive `err instanceof Error ? err.message : String(err)`
// pattern silently produces "[object Object]" for Supabase's PostgrestError /
// FunctionsHttpError shapes, which aren't instanceof Error but do carry a
// useful `.message` field. Centralising the coercion here keeps surface UI
// consistent and removes the gotcha.

export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  if (err == null) return fallback
  if (typeof err === 'string') return err.trim() || fallback
  if (err instanceof Error) return err.message || fallback
  if (typeof err === 'object') {
    const obj = err as { message?: unknown; error?: unknown }
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message
    // Some libraries nest the message under `.error`. Fall through if
    // neither exists rather than returning "[object Object]".
    if (typeof obj.error === 'string' && obj.error.trim()) return obj.error
  }
  return fallback
}
