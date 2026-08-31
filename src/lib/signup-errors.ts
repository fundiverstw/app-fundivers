// One reading of a failed account-creation call, for both funnels.
//
// supabase-js wraps every non-2xx edge response as a FunctionsHttpError whose
// `.message` is the useless "Edge Function returned a non-2xx status code";
// the function's own `{ error }` JSON is buried in a Response on `.context`.
// Digging it out and showing it verbatim is not much better — the strings the
// handlers return ("captcha verification failed", "too many signup attempts")
// are written for a log, are always English regardless of the shop's
// configured language, and tell a diver nothing they can act on. Both were the
// "it throws errors" complaint.
//
// So the wire strings stay where they are (the handlers' own tests pin them,
// and they read well in a dashboard log) and this maps them to shop copy on
// the way to a human.

import { isTransientInvokeError } from './edge-invoke'
import { t } from '../i18n'

export interface SignupFailure {
  /** Shop copy, ready to render. */
  message: string
  /** The address is taken — the useful next step is signing in, not retrying. */
  emailTaken: boolean
}

// Matched against the handler's `{ error }` string. Order matters only in that
// the first match wins; the patterns are disjoint.
const WIRE_PATTERNS: { pattern: RegExp; message: () => string }[] = [
  { pattern: /captcha/i,                             message: () => t.auth.captchaFailed },
  // Deliberately not /rate.?limit/: "rate-limit check failed" is the 500 the
  // handler returns when the RPC itself broke, and telling a diver to wait a
  // few minutes for that would be a lie. A real rejection is a 429, caught by
  // status above, and says "too many signup attempts".
  { pattern: /too many signup attempts/i,            message: () => t.auth.tooManyAttempts },
  { pattern: /event not found/i,                     message: () => t.auth.eventGone },
]

/**
 * A create-account / create-registration failure as something a diver can act
 * on. `fallback` is the caller's own "this didn't work" copy, used for
 * anything unrecognized — never the raw string.
 */
export async function readSignupFailure(
  error: Error & { context?: unknown },
  fallback: string,
): Promise<SignupFailure> {
  // The request never got a response at all — nothing was wrong with what the
  // diver typed, so don't send them back to re-check it.
  if (isTransientInvokeError(error)) return { message: t.auth.offline, emailTaken: false }

  const ctx = error.context
  let status: number | null = null
  let wire = ''

  if (ctx && typeof (ctx as Response).json === 'function') {
    status = (ctx as Response).status ?? null
    try {
      const body = await (ctx as Response).json() as { error?: string; code?: string }
      if (body.code === 'email_exists') return { message: t.auth.emailTaken, emailTaken: true }
      wire = body.error ?? ''
    } catch { /* body wasn't JSON — status is all we have */ }
  }

  // create-registration predates the `email_exists` code and reports a taken
  // address in prose.
  if (/already (been )?registered|already exists/i.test(wire)) {
    return { message: t.auth.emailTaken, emailTaken: true }
  }
  if (status === 429) return { message: t.auth.tooManyAttempts, emailTaken: false }

  for (const { pattern, message } of WIRE_PATTERNS) {
    if (pattern.test(wire)) return { message: message(), emailTaken: false }
  }

  return { message: fallback, emailTaken: false }
}
