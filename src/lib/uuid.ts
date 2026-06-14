const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

// Postgres `uuid` columns reject any non-UUID string, so a single malformed
// value in a `.in('_id', [...])` list makes the whole batch query error and
// return no rows — blanking every name, not just the bad one. Callers resolve
// IDs that come from free-form booking JSON, so filter to valid UUIDs first.
export function uniqueUuids(ids: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>()
  for (const id of ids) if (isUuid(id)) out.add(id)
  return [...out]
}
