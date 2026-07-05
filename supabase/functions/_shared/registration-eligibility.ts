// Server-side registration eligibility — the authoritative mirror of the
// RegisterForm / MultiRegisterForm gates. Keeping the decision here (pure, no
// Deno imports) lets create-registration enforce it before inserting a booking
// AND lets the vitest unit suite pin the exact rules. A crafted request that
// skips the form can't get past these.

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
  cert_level: string | null
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
 * Rules:
 *  1. The diver must have declared a certification — either a non-empty
 *     cert_level or the uncertified flag. (Blank both = blocked.)
 *  2. Event prerequisites the diver doesn't meet on their self-reported
 *     profile must be acknowledged (details.prereq_acked_at) to proceed:
 *       - a prereq cert is required but the diver declared uncertified, or
 *       - the event needs more logged dives than the diver reports.
 *     Free-text cert level is NOT rank-compared (no reliable mapping); only
 *     the unambiguous uncertified-vs-prereq case is treated as a mismatch.
 */
export function eligibilityError(
  profile: EligibilityProfile | null,
  event: EligibilityEvent | null,
  details: Record<string, unknown> | null | undefined,
): string | null {
  const certLevel = (profile?.cert_level ?? "").trim()
  const uncertified = profile?.uncertified === true
  if (!certLevel && !uncertified) {
    return "Add your certification level, or mark yourself as not certified yet, before registering."
  }

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
        return "This event has a certification or logged-dive prerequisite you don't meet yet. Please acknowledge the requirement to continue."
      }
    }
  }

  return null
}
