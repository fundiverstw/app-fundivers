// Per-user rate limits for the authenticated endpoints that send mail.
//
// The ledger and the sliding-window arithmetic live in the database
// (take_action_slot, 20260813000000). This module is the one place the limits
// themselves are written down, so tuning them is a single edit rather than a
// hunt through fifteen entry points.
//
// Deno-import-free on purpose: send-group-summary's handler is unit-tested from
// Node, so anything it reaches has to import cleanly there too.

export interface RateLimit {
  /** Attempts allowed inside the window. */
  limit: number
  /** Window length, as a Postgres interval literal. */
  window: string
}

/**
 * Every rate-limited action, with the reasoning for its number.
 *
 * These are abuse ceilings, not usage quotas: each is set well above what the
 * UI can produce in a day of ordinary use, so a diver never meets one by
 * accident, while a script meets it in seconds.
 */
export const RATE_LIMITS = {
  // One message per partner the shop lists, several times over.
  contact_partner: { limit: 10, window: '24 hours' },
  // A parent adds a family member occasionally; the hard ceiling on how many
  // may exist at all is trg_profiles_child_account_cap.
  create_child_account: { limit: 5, window: '24 hours' },
  // Registering for a partner package is a considered act, not a browse.
  register_package: { limit: 10, window: '24 hours' },
  register_scheduled_trip: { limit: 10, window: '24 hours' },
  // A trusted-partner introduction request.
  partner_connect: { limit: 10, window: '24 hours' },
  // One per group registration. Higher because a parent booking a family
  // across several events legitimately submits a few in one sitting.
  group_summary: { limit: 20, window: '24 hours' },
  // A whole-database CSV export. An admin takes one before a risky change or on
  // a schedule of their own — a handful a day is generous, and each one reads
  // every row in the project.
  database_backup: { limit: 5, window: '24 hours' },
} as const satisfies Record<string, RateLimit>

export type RateLimitedAction = keyof typeof RATE_LIMITS

// Structural shape of the service-role client's rpc(), so this module needs no
// supabase-js import and tests can pass a plain object.
export interface RpcClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

export interface SlotResult {
  allowed: boolean
  /** Seconds until the caller may retry. 0 when allowed. */
  retryAfterSeconds: number
}

/**
 * Claim a rate-limit slot for this user and action.
 *
 * Fails OPEN when the RPC itself errors. A limiter that has lost its database
 * connection should not be what stops a diver registering — the endpoints this
 * guards are ordinary shop functionality, and the downside of one unbounded
 * request during an outage is smaller than refusing every legitimate one.
 * The error is logged so an outage is visible rather than silent.
 */
export async function takeActionSlot(
  admin: RpcClient,
  userId: string,
  action: RateLimitedAction,
): Promise<SlotResult> {
  const { limit, window } = RATE_LIMITS[action]
  const { data, error } = await admin.rpc('take_action_slot', {
    p_user_id: userId,
    p_action:  action,
    p_limit:   limit,
    p_window:  window,
  })
  if (error) {
    console.error(`rate limiter unavailable for ${action}:`, error.message)
    return { allowed: true, retryAfterSeconds: 0 }
  }
  const wait = typeof data === 'number' ? data : Number(data ?? 0)
  if (!Number.isFinite(wait) || wait <= 0) return { allowed: true, retryAfterSeconds: 0 }
  return { allowed: false, retryAfterSeconds: wait }
}

/** The 429 body every rate-limited endpoint returns. */
export function rateLimitedBody(action: RateLimitedAction, retryAfterSeconds: number) {
  const hours = Math.ceil(retryAfterSeconds / 3600)
  return {
    error: `too many requests — try again in about ${hours} hour${hours === 1 ? '' : 's'}`,
    action,
    retry_after_seconds: retryAfterSeconds,
  }
}
