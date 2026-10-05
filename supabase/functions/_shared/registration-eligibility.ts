// Server-side registration eligibility — the authoritative mirror of the
// RegisterForm / MultiRegisterForm gates. The rule itself lives in
// src/lib/prereq-shortfall.ts, which both forms import too, so what the form
// shows and what the server refuses cannot drift.
//
// Personal details are not among the gates. Registering asks for an email and
// a password; name, date of birth, nationality, gender and certification are
// all optional. An event's prerequisites are the exception: a diver who falls
// short of them cannot book it.

import { t } from "./i18n.ts"
import {
  anyShortfall,
  prereqShortfall,
  type EligibilityEvent,
  type EligibilityProfile,
  type LadderRung,
} from "../../../src/lib/prereq-shortfall.ts"

export { prereqExempt } from "../../../src/lib/prereq-shortfall.ts"
export type { EligibilityEvent, EligibilityProfile, LadderRung }

/** The `cert_levels` columns prereqShortfall reads. */
export const LADDER_COLUMNS = "id, code, organization, rank, padi_equivalent_id"

/**
 * The fields of a profile patch the prerequisite rule reads, typed and only
 * when present — so a patch can be laid over the stored profile to grade the
 * diver as they will be once it is saved.
 */
export function pickEligibilityFields(patch: Record<string, unknown>): Partial<EligibilityProfile> {
  const out: Partial<EligibilityProfile> = {}
  if ("uncertified" in patch) out.uncertified = patch.uncertified === true
  if ("logged_dives" in patch) out.logged_dives = typeof patch.logged_dives === "number" ? patch.logged_dives : null
  if ("cert_level_code" in patch) out.cert_level_code = typeof patch.cert_level_code === "string" ? patch.cert_level_code : null
  if ("nitrox_certified" in patch) out.nitrox_certified = patch.nitrox_certified === true
  return out
}
/**
 * Returns a user-facing error string when the registration must be blocked, or
 * null when it may proceed.
 */
export function eligibilityError(
  profile: EligibilityProfile | null,
  event: EligibilityEvent | null,
  details: Record<string, unknown> | null | undefined,
  ladder: readonly LadderRung[],
): string | null {
  const short = prereqShortfall(profile, event, details?.nitrox_course_addon === true, ladder)
  return anyShortfall(short) ? t.emails.errors.prereqNotMet : null
}
