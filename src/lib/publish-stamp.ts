// Shared publish-stamp helper for the curated-listing tables (packages,
// scheduled_trips) whose admin CRUD stamps `published_at` the first time a row
// goes live so the diver board can order by "newest published". Re-publishing
// keeps the original stamp — we only set it when it's still null on both the new
// values and the existing row.

export function withPublishStamp<T extends { status?: string | null; published_at?: string | null }>(
  values: T,
  existing?: { published_at?: string | null } | null,
): T {
  if (values.status === 'published' && !values.published_at && !existing?.published_at) {
    return { ...values, published_at: new Date().toISOString() }
  }
  return values
}
