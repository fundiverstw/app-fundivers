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
    const digits = v.replace(/\D/g, '')
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
 * the right thing: "you said you hold nothing" and "pick your level" differ.
 */
export type CertShortfall = null | 'uncertified' | 'unstated' | 'below'

export interface PrereqShortfall {
  cert: CertShortfall
  dives: boolean
  nitrox: boolean
}

export function anyShortfall(s: PrereqShortfall): boolean {
  return s.cert !== null || s.dives || s.nitrox
}

/** A level's PADI equivalent — itself for a PADI level. */
export function padiRungOf(ladder: readonly LadderRung[], row: LadderRung | undefined): LadderRung | undefined {
  if (!row) return undefined
  return ladder.find(r => r.id === (row.padi_equivalent_id ?? row.id))
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

  const nitrox = event.nitrox_required === true
    && profile?.nitrox_certified !== true
    && !nitroxCourseAddon

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
  const held = padiRungOf(ladder, ladder.find(r => r.code === profile?.cert_level_code))
  if (!held) return 'unstated'
  return held.rank < required.rank ? 'below' : null
}
