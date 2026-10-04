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

export { parseReqDives } from "../../../src/lib/prereq-shortfall.ts"
export type { EligibilityEvent, EligibilityProfile, LadderRung }

/** The `cert_levels` columns prereqShortfall reads. */
export const LADDER_COLUMNS = "id, code, rank, padi_equivalent_id"

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
