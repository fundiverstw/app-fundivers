// Server-side registration eligibility — the authoritative mirror of the
// RegisterForm / MultiRegisterForm gates. Keeping the decision here (pure, no
// Deno imports) lets create-registration enforce it before inserting a booking
// AND lets the vitest unit suite pin the exact rules. A crafted request that
// skips the form can't get past these.
//
// Personal details are not among them. Registering asks for an email and a
// password; name, date of birth, nationality, gender and certification are all
// optional, so nothing here rejects a booking for a blank field. What survives
// is the acknowledgment of a prerequisite the diver does not meet.

import { t } from "./i18n.ts"

export function parseReqDives(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  // Course rows store req_dives as free text ("20", "20 dives"); pull the
  // leading digit run, matching how the SPA's courseDetails() coerces it.
  if (typeof v === "string") {
    const digits = v.replace(/\D/g, "")
    if (!digits) return null
    const n = Number(digits)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export interface EligibilityProfile {
  uncertified: boolean | null
  logged_dives: number | null
}

export interface EligibilityEvent {
  prereq_cert_id: string | null
  req_dives: number | string | null
}

/**
 * Returns a user-facing error string when the registration must be blocked, or
 * null when it may proceed.
 *
 * The only rule left is the acknowledgment: event prerequisites the diver
 * doesn't meet on their self-reported profile must be acknowledged
 * (details.prereq_acked_at) to proceed —
 *   - a prereq cert is required but the diver declared uncertified, or
 *   - the event needs more logged dives than the diver reports.
 * Free-text cert level is NOT rank-compared (no reliable mapping); only the
 * unambiguous uncertified-vs-prereq case is treated as a mismatch. A diver who
 * declared nothing at all is not a mismatch either — registering costs an email
 * and a password, and the shop settles certification at the counter.
 */
export function eligibilityError(
  profile: EligibilityProfile | null,
  event: EligibilityEvent | null,
  details: Record<string, unknown> | null | undefined,
): string | null {
  const uncertified = profile?.uncertified === true

  if (event) {
    const loggedDives = typeof profile?.logged_dives === "number" ? profile.logged_dives : 0
    const reqDives = parseReqDives(event.req_dives)
    const certMismatch = !!event.prereq_cert_id && uncertified
    const divesMismatch = reqDives != null && loggedDives < reqDives
    if (certMismatch || divesMismatch) {
      const acked = !!details
        && typeof details.prereq_acked_at === "string"
        && (details.prereq_acked_at as string).length > 0
      if (!acked) {
        return t.emails.errors.prereqNotMet
      }
    }
  }

  return null
}
