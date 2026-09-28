// Timing and error vocabulary for the Cloudflare Turnstile check, shared by the
// sign-up page and the register form. Kept out of TurnstileWidget.tsx because
// the unit-test setup replaces that module wholesale with a stub.

/**
 * How old a token may be and still be posted instead of re-running the check.
 *
 * Cloudflare accepts a token for 300 seconds. This leaves a minute for the
 * request itself, invokeWithRetry's backoff and a slow connection. It used to
 * be two minutes, which re-ran the check on anyone who solved it before filling
 * in the form — invisible for most visitors, but a second checkbox for anyone
 * Cloudflare gives the interactive challenge to.
 */
export const CAPTCHA_REUSE_MAX_AGE_MS = 240_000

// Client-side error codes no retry can fix: the site key is wrong or disabled,
// or this hostname is not on the widget's allowed list. Every other family
// (network, timeout, a failed challenge) is worth another attempt.
// https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
const CONFIG_ERROR_CODES = new Set(['110100', '110110', '110200', '400020', '400021', '400070'])

export function isTurnstileConfigError(code: string): boolean {
  return CONFIG_ERROR_CODES.has(code)
}
