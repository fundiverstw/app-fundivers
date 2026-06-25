// Date helpers shared across pages so the same formatting isn't reimplemented
// per-call-site.

/** A Date as a `YYYY-MM-DD` calendar string (UTC), for Supabase date columns. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
