// Canonical way to render a person: their legal name, with the optional
// nickname in parentheses — e.g. "Chen Zi-Ni (Jenny)". The legal name is the
// one that must match the diver's passport / ID; the nickname is informal and
// optional, so when it's blank (or identical to the name) we show the name
// alone, never empty parentheses.
export function personName(
  name: string | null | undefined,
  nickname: string | null | undefined,
): string {
  const n = (name ?? '').trim()
  const nick = (nickname ?? '').trim()
  // No legal name yet (e.g. a brand-new signup) — fall back to the nickname
  // alone. Empty string when we have neither, so callers can supply their own
  // placeholder (e.g. '(unknown)').
  if (!n) return nick
  return nick && nick !== n ? `${n} (${nick})` : n
}
