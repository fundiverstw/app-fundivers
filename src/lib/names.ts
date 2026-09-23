// Canonical way to render a person: their legal name, the one that must
// match the diver's passport / ID. Normalizes the column's NULLs and stray
// whitespace to an empty string, so callers can supply their own placeholder
// (e.g. '(unknown)') with a plain `||`.
export function personName(name: string | null | undefined): string {
  return (name ?? '').trim()
}
