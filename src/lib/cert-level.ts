// Divers' `cert_level` is free text — typed by the diver, or carried over from
// the Bubble import — so one certification arrives under a dozen spellings and
// under half a dozen agencies' names for it. Left alone, a single rung of the
// ladder splits across many bars on the BI panes: "Advanced Open Water" beside
// "Advanced Scuba Diver" beside "Advance Adventure Diver", which are one thing.
//
// The shop already owns the answer. `cert_levels` holds every agency's ladder
// with a `padi_equivalent_id` pointing at the PADI rung it corresponds to, so
// canonicalizing means matching the free text to a row and following that
// pointer — not maintaining a second, divergent opinion in code.
//
// Two things this deliberately does not do:
//
//   - Guess. An unmatched value passes through unchanged, so "PE40" stays
//     "PE40" and the admin can see there is a profile to fix. Folding it into
//     the nearest-looking rung would report a diver as qualified for something
//     they are not.
//   - Gate anything. This is display-only, for the dashboard. Booking
//     eligibility runs off `events.prereq_cert_id` → `cert_levels.id`, a
//     structured reference that never touches this text.

export interface CertLadderRow {
  id: string
  code: string
  name: string
  /** The `cert_levels.id` of the PADI rung this one corresponds to. */
  padi_equivalent_id: string | null
}

/**
 * Abbreviations and shorthand that no agency's ladder spells out, mapped to the
 * PADI `code` they mean. Everything an agency does name — "Advanced Scuba
 * Diver", "3-Star Diver", "Master Diver" — is matched against the ladder
 * instead, so this list stays short and does not drift from the table.
 */
const SHORTHAND: Record<string, string> = {
  owd: 'open_water',
  rd: 'rescue',
  owinstructor: 'instructor',
  owsi: 'instructor',
  staffinstructor: 'idc_staff',
  cd: 'course_director',
}

/**
 * Comparison key: lowercase, alphanumerics only, with a trailing "diver"
 * dropped so "Advanced Open Water Diver" and "Advanced Open Water" agree, and
 * the common "advance" typo repaired so "Advance Adventure Diver" reaches SDI's
 * "Advanced Adventure Diver".
 */
function key(value: string): string {
  let k = value.toLowerCase().replace(/[^a-z0-9]/g, '')
  k = k.replace(/^advance(?!d)/, 'advanced')
  if (k.endsWith('diver') && k !== 'diver') k = k.slice(0, -'diver'.length)
  return k
}

/**
 * Candidate readings of one messy value, most faithful first.
 *
 * "AOW & nitrox" is an AOW diver who also holds a specialty; "OW/Scuba Diver"
 * is someone hedging between two names for the same rung. Both are the leading
 * segment plus noise, so fall back to that segment — but only after the whole
 * string has failed, since an agency really does name a rung
 * "Open Water / Dive Con Instructor".
 */
function readings(trimmed: string): string[] {
  const candidates = [trimmed]
  const head = trimmed.split(/[&/,+]/)[0].trim()
  if (head && head !== trimmed) candidates.push(head)
  return candidates
}

export interface CertLevelResolver {
  (raw: string | null | undefined): string
}

/**
 * Build a resolver over the shop's own `cert_levels` rows.
 *
 * Pass the whole table — every agency, not just PADI. The cross-agency rows are
 * what make "Master Diver" (SSI) and "3-Star Diver" (CMAS) resolvable at all.
 */
export function buildCertLevelResolver(ladder: readonly CertLadderRow[]): CertLevelResolver {
  const byId = new Map(ladder.map(row => [row.id, row]))
  const byCode = new Map(ladder.map(row => [row.code, row]))

  /** Every spelling the ladder itself offers → the row it names. */
  const byText = new Map<string, CertLadderRow>()
  for (const row of ladder) {
    for (const spelling of [row.name, row.code]) {
      const k = key(spelling)
      if (k && !byText.has(k)) byText.set(k, row)
    }
  }

  /** Follow a row to the PADI rung's display name. */
  function padiNameOf(row: CertLadderRow): string | null {
    const target = row.padi_equivalent_id ? byId.get(row.padi_equivalent_id) : row
    return target?.name ?? null
  }

  return (raw: string | null | undefined): string => {
    const trimmed = (raw ?? '').trim()
    if (!trimmed) return ''

    for (const reading of readings(trimmed)) {
      const k = key(reading)

      const shorthandCode = SHORTHAND[k]
      if (shorthandCode) {
        const row = byCode.get(shorthandCode)
        const name = row && padiNameOf(row)
        if (name) return name
      }

      const row = byText.get(k)
      if (row) {
        const name = padiNameOf(row)
        if (name) return name
      }
    }

    return trimmed
  }
}

/** Convenience for a single lookup. Prefer the resolver when mapping many. */
export function canonicalCertLevel(
  raw: string | null | undefined,
  ladder: readonly CertLadderRow[],
): string {
  return buildCertLevelResolver(ladder)(raw)
}
