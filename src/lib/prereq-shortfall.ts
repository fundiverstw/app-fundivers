// Where a diver falls short of an event's prerequisites. A diver who does
// cannot book it — there is no acknowledgment to tick.
//
// One copy, shared: the register forms import it to show what's missing and
// disable submit, and supabase/functions/_shared/registration-eligibility.ts
// imports it to refuse the booking. Import-free, so the Deno edge runtime can
// take it directly.

export function parseReqDives(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  // Course rows store req_dives as free text ("20", "20 dives"); pull the
  // leading digit run, matching how the SPA's courseDetails() coerces it.
  if (typeof v === 'string') {
    // The first run only: "10-20" is 10, not 1020.
    const digits = v.match(/\d+/)?.[0]
    if (!digits) return null
    const n = Number(digits)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** The `cert_levels` columns the rule reads. */
export interface LadderRung {
  id: string
  code: string
  organization: string
  rank: number
  padi_equivalent_id: string | null
}

export interface EligibilityProfile {
  uncertified: boolean | null
  logged_dives: number | null
  /** A `cert_levels.code`; null or '' when no level has been picked. */
  cert_level_code: string | null
  nitrox_certified: boolean | null
}

export interface EligibilityEvent {
  prereq_cert_id: string | null
  req_dives: number | string | null
  nitrox_required: boolean | null
}

/**
 * Why a diver doesn't reach the level an event asks for; null when they do or
 * the event asks for none. Carried rather than re-derived so the form can say
 * the right thing: "you said you hold nothing", "pick your level" and "the
 * level you picked has no PADI equivalent to compare" all differ.
 */
export type CertShortfall = null | 'uncertified' | 'unstated' | 'unranked' | 'below'

export interface PrereqShortfall {
  cert: CertShortfall
  dives: boolean
  nitrox: boolean
}

/**
 * Whether a diver must add the nitrox course to book an event: it requires
 * nitrox and they don't hold the certification. The forms offer and price the
 * course on this, and the gate below refuses on it.
 */
export function needsNitroxCourse(
  event: Pick<EligibilityEvent, 'nitrox_required'> | null | undefined,
  nitroxCertified: boolean | null | undefined,
): boolean {
  return event?.nitrox_required === true && nitroxCertified !== true
}

/**
 * Whether a register form's "Nitrox certified" tick answers a nitrox
 * prerequisite: a fresh claim needs a card behind it — on file, or being
 * uploaded with this submit — unless the profile already said so. Otherwise
 * the nitrox course is offered instead.
 */
export function nitroxAnswered({ ticked, storedCertified, cardOnFile, cardPending = false }: {
  ticked: boolean
  storedCertified: boolean | null | undefined
  cardOnFile: boolean
  cardPending?: boolean
}): boolean {
  return ticked && (storedCertified === true || cardOnFile || cardPending)
}

export function anyShortfall(s: PrereqShortfall): boolean {
  return s.cert !== null || s.dives || s.nitrox
}

/**
 * The register forms ask about certification and logged dives on step 2 and
 * offer the nitrox course on step 3, so each step blocks on its own part of a
 * shortfall. 'all' is both, for the final step's summary.
 */
export type PrereqStep = 2 | 3 | 'all'

export function shortfallForStep(s: PrereqShortfall, step: PrereqStep): PrereqShortfall {
  if (step === 2) return { ...s, nitrox: false }
  if (step === 3) return { cert: null, dives: false, nitrox: s.nitrox }
  return s
}

/**
 * Whether a booking skips the prerequisite gate: an admin or staff member
 * booking someone other than themselves (the shop deciding), or an admin
 * editing a booking that already exists. The register forms and the server
 * all ask this, so they agree on who is let through.
 */
export function prereqExempt({ privileged, forSomeoneElse, isEdit = false }: {
  privileged: boolean
  forSomeoneElse: boolean
  isEdit?: boolean
}): boolean {
  return isEdit || (privileged && forSomeoneElse)
}

type Rung = Pick<LadderRung, 'id' | 'organization' | 'padi_equivalent_id'>

/**
 * A level's PADI equivalent — itself for a PADI level, whether or not its row
 * points at itself. Another agency's level with no equivalent recorded has
 * none: its own rank is on that agency's ladder, not PADI's, so reading it as
 * a PADI rank would pass a diver for a level they may not hold.
 */
export function padiRungOf<R extends Rung>(ladder: readonly R[], row: R | undefined): R | undefined {
  if (!row) return undefined
  if (row.padi_equivalent_id) return ladder.find(r => r.id === row.padi_equivalent_id)
  return row.organization === 'PADI' ? row : undefined
}

/**
 * `events.prereq_cert_id` names a PADI level; the diver's code may be any
 * agency's. Both go through `padi_equivalent_id` and the PADI ranks are
 * compared, so SSI Advanced Open Water clears an AOW requirement and Open
 * Water does not.
 *
 * No picked level counts as short: on an event that asks for AOW, silence is
 * not evidence. Nitrox is its own axis, answered by `nitrox_certified` or by
 * buying the nitrox course with the booking (`nitroxCourseAddon`).
 */
export function prereqShortfall(
  profile: EligibilityProfile | null,
  event: EligibilityEvent | null,
  nitroxCourseAddon: boolean,
  ladder: readonly LadderRung[],
): PrereqShortfall {
  if (!event) return { cert: null, dives: false, nitrox: false }

  const loggedDives = typeof profile?.logged_dives === 'number' ? profile.logged_dives : 0
  const reqDives = parseReqDives(event.req_dives)
  const dives = reqDives != null && loggedDives < reqDives

  const nitrox = needsNitroxCourse(event, profile?.nitrox_certified) && !nitroxCourseAddon

  return { cert: certShortfall(profile, event.prereq_cert_id, ladder), dives, nitrox }
}

function certShortfall(
  profile: EligibilityProfile | null,
  prereqCertId: string | null,
  ladder: readonly LadderRung[],
): CertShortfall {
  if (!prereqCertId) return null
  const required = padiRungOf(ladder, ladder.find(r => r.id === prereqCertId))
  // Not on the ladder (or the ladder hasn't loaded): nothing to grade against.
  if (!required) return null
  if (profile?.uncertified === true) return 'uncertified'
  const picked = ladder.find(r => r.code === profile?.cert_level_code)
  if (!picked) return 'unstated'
  const held = padiRungOf(ladder, picked)
  if (!held) return 'unranked'
  return held.rank < required.rank ? 'below' : null
}
