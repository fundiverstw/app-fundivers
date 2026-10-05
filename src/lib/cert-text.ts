// How a profile's certification text reads once `cert_level_code` is the
// source of truth. Import-free, like prereq-shortfall.ts, so the Deno edge
// functions that print a diver's level (the confirmation and group emails, the
// diver export) read it the same way the app does.

export interface CertTextFields {
  cert_level_code?: string | null
  cert_agency?: string | null
  cert_level?: string | null
  uncertified?: boolean | null
}

/**
 * The free-text certification a profile still carries when no level has been
 * picked: a legacy value the backfill could not place. Null once a level is
 * picked — the text is then only the database's copy of that row. An agency
 * with no level names no certification (the backfill skips it too), so it is
 * not one; nor is text left on a profile marked "not certified", which the
 * backfill also leaves alone.
 */
export function legacyCertText(profile: CertTextFields | null | undefined): string | null {
  if (!profile || profile.cert_level_code || profile.uncertified || !profile.cert_level?.trim()) return null
  return [profile.cert_agency, profile.cert_level].filter(Boolean).join(' ')
}

/**
 * The level to print next to the agency: the picked level's name, or legacy
 * text passed through `notPlaced` so it never reads as a level. Null when the
 * profile claims none.
 */
export function printedCertLevel(
  profile: CertTextFields | null | undefined,
  notPlaced: (typed: string) => string,
): string | null {
  if (profile?.cert_level_code) return profile.cert_level?.trim() || null
  return legacyCertText(profile) ? notPlaced(profile!.cert_level!.trim()) : null
}

/**
 * A profile's certification as printed documents and screens show it: the
 * level (see printedCertLevel) and the agency beside it — only beside a level,
 * since an agency left on a "not certified" profile names nothing.
 */
export function printedCert(
  profile: CertTextFields | null | undefined,
  notPlaced: (typed: string) => string,
): { level: string | null; org: string | null } {
  const level = printedCertLevel(profile, notPlaced)
  return { level, org: level ? profile?.cert_agency?.trim() || null : null }
}

/**
 * The `cert_level_code` a register form's profile patch carries. "Not
 * certified" or nothing picked clears it. A code the loaded ladder doesn't
 * list — a draft or a stale session from before its level was renamed or
 * removed, or a ladder that never loaded — is left off, so the profile keeps
 * what it has rather than the update failing the foreign key.
 */
export function certLevelCodePatch(
  code: string,
  uncertified: boolean,
  ladder: ReadonlyArray<{ code: string }>,
): { cert_level_code?: string | null; uncertified?: false } {
  if (uncertified || code.trim() === '') return { cert_level_code: null }
  // A picked level says "certified", whatever the stored flag says now: the
  // two together can't break the profiles_cert_level_or_uncertified check.
  return ladder.some(l => l.code === code) ? { cert_level_code: code, uncertified: false } : {}
}

/**
 * The code a profile will hold once a register form's patch lands: the
 * patch's when it carries one, else the stored one. The forms grade on this,
 * as the server grades the stored row with the patch laid over it.
 */
export function effectiveCertCode(
  patch: { cert_level_code?: string | null },
  stored: string | null | undefined,
): string | null {
  return 'cert_level_code' in patch ? patch.cert_level_code ?? null : (stored ?? null)
}
